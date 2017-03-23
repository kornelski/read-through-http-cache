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
            stale:false, // errors must expire
            maxAge: options.maxAge || 24*3600*1000,
        });

        this._CachePolicy = options.CachePolicy || CachePolicy;
        this._coldStorage = options.coldStorage;
    }

    async getCached(url, request, onCacheMissCallback) {
        if (!url || !request || !onCacheMissCallback) throw Error("Bad cache args");

        const cached = this._storage.get(url);
        let revalidationHeaders = {};

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
            if (cached.policy) {
                revalidationHeaders = cached.policy.revalidationHeaders(request);
            }
        }

        let resultPromise;
        if (this._coldStorage) {
            resultPromise = this._coldStorage.get(url).catch(err => {
                    console.error(err);
                }).then(res => {
                    if (res) {
                        res.wasInColdStorageHack = true;
                        return res;
                    }
                    return onCacheMissCallback(revalidationHeaders);
                });
        } else {
            resultPromise = Promise.resolve(revalidationHeaders).then(onCacheMissCallback);
        }

        const workInProgressPromise = resultPromise.then(res => {
            if (res && res.headers) {
                const inColdStoarge = res.wasInColdStorageHack;
                const policy = new this._CachePolicy(request, res, {shared:true, ignoreCargoCult:true});
                const timeToLive = policy.timeToLive(res);
                if (timeToLive) {
                    res.headers['im2-cache'] = inColdStoarge ? 'cold' : 'miss';
                    const cost = 4000 + (Buffer.isBuffer(res.body) ? res.body.byteLength : 8000);
                    this._storage.set(url, {cost, inColdStoarge, policy, promise:resultPromise}, timeToLive);
                } else {
                    this._storage.del(url);
                    res.headers['im2-cache'] = 'no-cache';
                }
            } else {
                this._storage.del(url);
            }
            return res;
        }, err => {
            this._storage.set(url, {cost: 30000, promise:resultPromise}, this._errorTimeout);
            throw err;
        });

        // thundering herd protection
        this._storage.set(url, {cost:1, temp:true, promise: workInProgressPromise}, this._busyTimeout);
        return workInProgressPromise;
    }

    _putInColdStorage(url, res, cached) {
        if (!cached.inColdStoarge && this._coldStorage) {
            const ttl = cached.policy.timeToLive();
            if (ttl >= 3600*1000) { // don't bother if < 1h min time
                cached.inColdStoarge = true;
                this._coldStorage.set(url, res, ttl).catch(err => {
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
