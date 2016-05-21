'use strict';

const LRU = require('lru-cache');

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
            return cached.promise;
        }

        const resultPromise = Promise.resolve({}).then(callback).then(res => {
            const maxAge = this._maxAgeForResponse(res);
            if (maxAge) {
                const cost = 4000 + (Buffer.isBuffer(res.body) ? res.body.byteLength : 8000);
                this._storage.set(url, {cost, promise:resultPromise}, maxAge);
            }
            return res;
        }, err => {
            this._storage.set(url, {cost: 30000, promise:resultPromise}, this._errorTimeout);
            throw err;
        });
        return resultPromise;
    },

    _maxAgeForResponse(res) {
        if (!res || !res.headers || !res.body) {
            console.warn("Suspicious response", res);
            return 0;
        }

        const cc = res.headers['cache-control'];
        if (/private|no-cache|no-store/.test(cc)) {
            return 0;
        }

        if (res.headers['vary']) {
            const tokens = res.headers['vary'].split(/[\s,]+/).filter(t => !/^(?:accept-charset|accept-encoding|host|accept|origin)$/i.test(t));
            if (tokens.length) {
                return 0; // TODO
            }
        }

        if (res.headers['expires']) {
            const expires = Date.parse(res.headers['expires']);
            if (isFinite(expires)) {
                let serverTime = Date.parse(res.headers['date'])
                const now = Date.now();
                const maxClockDrift = 8*3600*1000;
                if (!isFinite(serverTime) || serverTime < now-maxClockDrift || serverTime > now+maxClockDrift) {
                    serverTime = now;
                }
                if (expires < serverTime) {
                    return 0;
                }
            }
        }

        if (cc) {
            const m = cc.match(/s-maxage=([0-9]+)/);
            if (m) {
                return m[1]*1000;
            }
            const n = cc.match(/max-age=([0-9]+)/);
            if (n) {
                return n[1]*1000;
            }
        }
        return 0;
    },
}

module.exports = Cache;
