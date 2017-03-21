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

        this._coldStorage = options.coldStorage;
    }

    getCached(url, request, onCacheMissCallback) {
        if (!url || !request || !onCacheMissCallback) throw Error("Bad cache args");

        const cached = this._storage.get(url);
        if (cached) {
            if (cached.temp) {
                return cached.promise.then(() => {
                    return this.getCached(url, request, onCacheMissCallback);
                });
            }
            if (!cached.policy || cached.policy.satisfiesWithoutRevalidation(request)) {
                return cached.promise.then(res => {
                    if (cached.policy) {
                        this._putInColdStorage(url, res, cached);

                        res.headers = cached.policy.responseHeaders();
                        res.headers['im2-cache'] = 'hit';
                        res.ttl = cached.policy.timeToLive();
                    }
                    return res;
                });
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
                    return onCacheMissCallback({});
                });
        } else {
            resultPromise = Promise.resolve({}).then(onCacheMissCallback);
        }

        const workInProgressPromise = resultPromise.then(res => {
            if (res && res.headers) {
                const inColdStoarge = res.wasInColdStorageHack;
                const policy = new CachePolicy(request, res, {shared:true, ignoreCargoCult:true});
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
            cached.inColdStoarge = true;
            this._coldStorage.set(url, res, cached.policy.timeToLive()).catch(err => {
                console.error(err);
                cached.inColdStoarge = false;
            });
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
