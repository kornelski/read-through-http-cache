'use strict';

const LRU = require('lru-cache');
const CachePolicy = require('http-cache-semantics');

function Cache(options) {
    if (!options) options = {};

    this._errorTimeout = options.errorTimeout || 200;

    this._storage = options.storage || new LRU({
        max: options.size || 500*1024*1024, // 500MB
        length(obj) {
            return obj.cost;
        },
        stale:false, // errors must expire
        maxAge: options.maxAge || 24*3600*1000,
    });
}

Cache.prototype = {
    getCached(url, request, callback) {
        if (!url || !request || !callback) throw Error("Bad cache args");

        return Promise.resolve(this._storage.get(url)).then(cached => {
            if (cached) {
                if (!cached.policy || cached.policy.satisfiesWithoutRevalidation(request)) {
                    return cached.promise.then(res => {
                        if (cached.policy) {
                            res.headers = cached.policy.responseHeaders();
                            res.headers['im2-cache'] = 'hit';
                        }
                        return res;
                    });
                }
            }

            const resultPromise = Promise.resolve({}).then(callback);
            return resultPromise.then(res => {
                if (res && res.headers) {
                    const policy = new CachePolicy(request, res, {shared:true});
                    const timeToLive = policy.timeToLive(res);
                    if (timeToLive) {
                        res.headers['im2-cache'] = 'miss';
                        const cost = 4000 + (Buffer.isBuffer(res.body) ? res.body.byteLength : 8000);
                        this._storage.set(url, {cost, policy, promise:resultPromise}, timeToLive);
                    } else {
                        res.headers['im2-cache'] = 'no-cache';
                    }
                }
                return res;
            }, err => {
                this._storage.set(url, {cost: 30000, promise:resultPromise}, this._errorTimeout);
                throw err;
            });
        });
    },
}

module.exports = Cache;
