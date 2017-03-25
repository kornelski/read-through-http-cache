'use strict';

const assert = require('assert');
const Cache = require('..');
const CachePolicy = require('http-cache-semantics');

const req = {
    headers: {},
}

function mockResponseWith(headers) {
    return {
        status: 200,
        testedObject:true,
        body: new Buffer(0),
        headers,
    };
}

describe('Cache', function() {
    it('simple miss', function() {
        const cache = new Cache();
        let called = false;
        return cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            called = true;
            return mockResponseWith({});
        }).then(res => {
            assert(called);
            assert(res);
            assert(res.testedObject);
        });
    });

    it('simple hit', function() {
        const cache = new Cache();
        let missInParallelCalled = false;
        return cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'cache-control': 'public, max-age=999999',
                'orig': 'yes',
            })
        }).then(res => {
            assert(res.testedObject);
            return Promise.all([
                cache.getCached('http://foo.bar/baz.quz', req, opt => assert.fail("should cache", opt)),
                cache.getCached('https://foo.bar/baz.quz', req, reqOpts => {
                    assert(reqOpts);
                    missInParallelCalled = true;
                    return mockResponseWith({});
                }),
            ]);
        }).then(tmp => {
            assert(tmp[0].testedObject);
            assert(tmp[1].testedObject);
            assert.equal(tmp[0].headers.orig, 'yes');
            assert(missInParallelCalled);
        });
    });

    it('cache with expires', function() {
        const cache = new Cache();
        return cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'date': new Date().toGMTString(),
                'expires': new Date(Date.now() + 2000).toGMTString(),
            });
        }).then(() => {
            return cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
                assert.fail("should cache");
            });
        });
    });

    it('cache old files', async function() {
        const cache = new Cache();
        await cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'date': 'Sat, 21 May 2016 13:54:34 GMT',
                'last-modified': 'Mon, 07 Mar 2016 11:52:56 GMT',
            });
        });
        const res = await cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert.fail("should cache");
        });
        assert.equal(res.headers['last-modified'], 'Mon, 07 Mar 2016 11:52:56 GMT');
    });

    it('cache error', function() {
        const cache = new Cache();
        return cache.getCached('http://foo.bar/baz.quz', req, () => {
            throw Error("test");
        }).then(res => assert.fail("nope", res), err => {
            assert.equal("test", err.message);
            return cache.getCached('http://foo.bar/baz.quz', req, () => {
                assert.fail("don't call");
            });
        }).then(res => assert.fail("nope", res), err => {
            assert.equal("test", err.message);
        });
    });

    it('cache error expires', async function() {
        const cache = new Cache({errorTimeout: 5});
        try {
            const res = await cache.getCached('http://foo.bar/baz.quz', req, () => {
                throw Error("test");
            });
            assert.fail("nope", res);
        } catch(err) {
            assert.equal("test", err.message);
        }
        await new Promise(res => setTimeout(res, 6));
        const res = await cache.getCached('http://foo.bar/baz.quz', req, () => {
            return mockResponseWith({'expir':'ed'});
        });
        assert.equal(res.headers.expir, 'ed');
    });

    it('cache error per url', function() {
        const cache = new Cache();
        return cache.getCached('http://foo.bar/baz.quz', req, () => {
            throw Error("test");
        }).then(res => assert.fail("nope", res), err => {
            assert.equal("test", err.message);
        }).then(() => {
            return cache.getCached('http://foo.bar/baz.quz?', req, () => {
                return mockResponseWith({'got':'it'});
            });
        }).then(res => {
            assert(res.headers);
            assert.equal(res.headers.got, 'it');
        });
    });

    it('miss private cache', async function() {
        const cache = new Cache();
        let called = 0;
        const res = await cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            called++;
            return mockResponseWith({
                'cache-control': 'private, max-age=999999',
            });
        });
        assert(res.testedObject);
        const res2 = await cache.getCached('http://foo.bar/baz.quz', req, () => {
            called++;
            return mockResponseWith({
                'cache-control': 'private, max-age=333',
                'second': 'yes',
            });
        });
        assert(res2.testedObject);
        assert.equal(2, called);
        assert.equal(res2.headers.second, 'yes');
    });

    it('miss cookie', async function() {
        let now = Date.now();
        const cache = new Cache({CachePolicy: class Rewind extends CachePolicy {
            now() {
                return now;
            }
        }});
        let called = 0;
        await cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            called++;
            return mockResponseWith({
                'set-cookie': 'foo=bar',
                'cache-control': 'max-age=99',
            });
        });
        now += 15000;
        const res = await cache.getCached('http://foo.bar/baz.quz', req, () => {
            called++;
            return mockResponseWith({
                'second': 'yes',
            });
        });
        assert(res.testedObject);
        assert.equal(2, called);
        assert.equal(res.headers.second, 'yes');
    });

    it('cache public cookie', async function() {
        const cache = new Cache();
        let called = 0;
        await cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            called++;
            return mockResponseWith({
                'set-cookie': 'foo=bar',
                'cache-control': 'public, max-age=99',
            });
        })

        const res = await cache.getCached('http://foo.bar/baz.quz', req, () => {
            assert.fail("should cache")
        });
        assert(res.testedObject);
        assert.equal(1, called);
        assert.equal(res.headers['set-cookie'], 'foo=bar');
    });

    it('miss max-age=0', function() {
        const cache = new Cache();
        let called = 0;
        return cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            called++;
            return mockResponseWith({
                'cache-control': 'public, max-age=0',
            });
        }).then(res => {
            assert(res.testedObject);
            return cache.getCached('http://foo.bar/baz.quz', req, () => {
                called++;
                return mockResponseWith({
                    'cache-control': 'public, max-age=333',
                    'second': 'yes',
                });
            });
        }).then(res => {
            assert(res.testedObject);
            assert.equal(2, called);
            assert.equal(res.headers.second, 'yes');
        });
    });
});
