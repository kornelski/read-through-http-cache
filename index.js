'use strict';

const LRU = require('lru-cache');
const CachePolicy = require('http-cache-semantics');

function Cache(options) {
    if (!options) options = {};

    this._errorTimeout = options.errorTimeout || 200;

    this._storage = new LRU({
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

        const cached = this._storage.get(url);
        if (cached) {
            return cached.promise.then(res => {
                res.headers['im2-cache'] = 'hit'; // res is shared mutable, so that is race-y
                return res;
            });
        }

        const resultPromise = Promise.resolve({}).then(callback);
        return resultPromise.then(res => {
            if (res && res.headers) {
                const policy = new CachePolicy(request, res, {shared:true});
                const maxAge = policy.maxAge(res);
                if (maxAge) {
                    res.headers['im2-cache'] = 'miss';
                    res.headers['expires'] = new Date(Date.now() + maxAge*1000).toGMTString();
                    const cost = 4000 + (Buffer.isBuffer(res.body) ? res.body.byteLength : 8000);
                    this._storage.set(url, {cost, promise:resultPromise}, maxAge*1000);
                } else {
                    res.headers['im2-cache'] = 'no-cache';
                }
            }
            return res;
        }, err => {
            this._storage.set(url, {cost: 30000, promise:resultPromise}, this._errorTimeout);
            throw err;
        });
    },
}

module.exports = Cache;
