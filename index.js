'use strict';

const LRU = require('lru-cache');
const CachePolicy = require('http-cache-semantics');

module.exports = class Cache {
    constructor(options = {}) {
        this._busyTimeout = options.busyTimeout || 2000;
        this._errorTimeout = options.errorTimeout || 200;

        this._storage = options.storage || new LRU({
            max: options.size || 500*1024*1024, // 500MB
            length(obj) {
                return obj.cost;
            },
            dispose: (url, cached) => {
                if (cached && !cached.temp && cached.policy) {
                    cached.promise.then(res => {
                        this._putInColdStorage(url, res, cached);
                    });
                }
            },
            stale: true, // needed for revalidation
            maxAge: options.maxAge || 24*3600*1000,
        });

        this._CachePolicy = options.CachePolicy || CachePolicy;
        this._coldStorage = options.coldStorage;
    }

    async getCached(url, request, onCacheMissCallback) {
        if (!url || !request || !onCacheMissCallback) throw Error("Bad cache args");

        let cached = this._storage.get(url);

        // Normal stale responses are allowed, but it'd be bad for timeouts and errors
        if (cached && cached.expires && cached.expires < Date.now()) {
            this._storage.del(url);
            cached = undefined;
        }

        if (cached) {
            if (cached.temp) {
                await cached.promise;
                return this.getCached(url, request, onCacheMissCallback);
            }
            if (!cached.policy || cached.policy.satisfiesWithoutRevalidation(request)) {
                const res = await cached.promise;
                if (cached.policy) {
                    this._putInColdStorage(url, res, cached);

                    res.headers = cached.policy.responseHeaders();
                    res.headers['im2-cache'] = 'hit';
                    res.ttl = cached.policy.timeToLive();
                }
                return res;
            }
        }

        const resultPromise = this._getResult(url, request, cached, onCacheMissCallback)
        .then(({res, policy, inColdStoarge}) => {
            if (policy && res && res.status) {
                res.headers = policy.responseHeaders(); // Headers must always be sanitized
                if (policy.storable()) {
                    const timeToLive = policy.timeToLive();
                    res.headers['im2-cache'] = inColdStoarge ? 'cold' : 'miss';
                    const cost = 4000 + (Buffer.isBuffer(res.body) ? res.body.byteLength : 8000);
                    const staleTime = timeToLive * 0.01 + 1000 + Math.random()*10000;
                    this._storage.set(url, {cost, inColdStoarge, policy, promise:resultPromise}, timeToLive + staleTime);
                } else {
                    this._storage.del(url);
                    res.headers['im2-cache'] = 'no-cache';
                }
                return res;
            } else {
                this._storage.del(url);
                console.error("empty res", res, policy);
                throw Error(`Empty result: ${url}`);
            }
        }).catch(err => {
            // Self-referential awkwardness to avoid having a copy of the promise with uncaught error
            this._storage.set(url, {cost: 30000, expires:Date.now() + this._errorTimeout, promise:resultPromise}, this._errorTimeout);
            throw err;
        });

        // thundering herd protection
        this._storage.set(url, {cost:1, expires:Date.now() + this._busyTimeout, temp:true, promise:resultPromise}, this._busyTimeout);
        return resultPromise;
    }

    async _getResult(url, request, cached, onCacheMissCallback) {
        if (this._coldStorage) {
            const cold = await this._coldStorage.get(url).catch(err => {console.error("Ignored cold storage", err);});
            if (cold && cold.policy) {
                if (cold.policy.satisfiesWithoutRevalidation(request)) {
                    return {res: cold.response, policy: cold.policy, inColdStoarge: true};
                }
                const headers = cold.policy.revalidationHeaders(request);
                let res = await onCacheMissCallback(headers);

                const {policy, modified} = cold.policy.revalidatedPolicy({headers}, res);
                if (!modified) {
                    res = cold.response;
                } else if (res.status === 304) {
                    res = await onCacheMissCallback({});
                }
                return {res, policy};
            }
        }

        if (cached && cached.policy && !cached.isError) {
            const headers = cached.policy.revalidationHeaders(request);
            let res = await onCacheMissCallback(headers);

            const {policy, modified} = cached.policy.revalidatedPolicy({headers}, res);
            cached.policy = policy; // That's a bit hacky faster update, taking advantage of a shared mutable obj
            if (!modified) {
                res = await cached.promise;
            } else if (res.status === 304) {
                res = await onCacheMissCallback({});
            }
            return {res, policy};
        }

        const res = await onCacheMissCallback({});
        if (res.status === 304) {
            throw Error("Unexpected revalidation");
        }
        const policy = new this._CachePolicy(request, res, {shared:true, ignoreCargoCult:true});

        return {res, policy};
    }

    _putInColdStorage(url, res, cached) {
        if (!cached.inColdStoarge && this._coldStorage) {
            const ttl = cached.policy.timeToLive();
            if (ttl >= 3600*1000) { // don't bother if < 1h min time
                cached.inColdStoarge = true;
                this._coldStorage.set(url, res, cached.policy).catch(err => {
                    console.error(err);
                    cached.inColdStoarge = false;
                });
            }
        }
    }

    dump() {
        const arr = [];
        this._storage.forEach((cached, url) => {
            if (cached && !cached.temp && cached.policy) {
                arr.push(cached.promise.then(res => {
                    return this._putInColdStorage(url, res, cached);
                }));
            }
        });
        return Promise.all(arr)
    }

    purge() {
        this._storage.reset();
    }
};
