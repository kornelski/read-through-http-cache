'use strict';

const assert = require('assert');
const Cache = require('..');

function mockResponseWith(headers) {
    return {
        testedObject:true,
        body: new Buffer(0),
        headers,
    };
}

describe('Cache', function() {
    it('simple miss', function() {
        const cache = new Cache();
        let called = false;
        return cache.getCached('http://foo.bar/baz.quz', {}, reqOpts => {
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
        return cache.getCached('http://foo.bar/baz.quz', {}, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'cache-control': 'public, max-age=999999',
                'orig': 'yes',
            })
        }).then(res => {
            assert(res.testedObject);
            return Promise.all([
                cache.getCached('http://foo.bar/baz.quz', {}, opt => assert.fail("should cache", opt)),
                cache.getCached('https://foo.bar/baz.quz', {}, reqOpts => {
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
        return cache.getCached('http://foo.bar/baz.quz', {}, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'date': new Date().toGMTString(),
                'expires': new Date(Date.now() + 2000),
            });
        }).then(() => {
            return cache.getCached('http://foo.bar/baz.quz', {}, reqOpts => {
                assert.fail("should cache");
            });
        });
    });

    it('cache error', function() {
        const cache = new Cache();
        return cache.getCached('http://foo.bar/baz.quz', {}, () => {
            throw Error("test");
        }).then(res => assert.fail("nope", res), err => {
            assert.equal("test", err.message);
            return cache.getCached('http://foo.bar/baz.quz', {}, () => {
                assert.fail("don't call");
            });
        }).then(res => assert.fail("nope", res), err => {
            assert.equal("test", err.message);
        });
    });

    it('cache error expires', function() {
        const cache = new Cache({errorTimeout: 5});
        return cache.getCached('http://foo.bar/baz.quz', {}, () => {
            throw Error("test");
        }).then(res => assert.fail("nope", res), err => {
            assert.equal("test", err.message);
            return new Promise(res => setTimeout(res, 6));
        }).then(() => {
            return cache.getCached('http://foo.bar/baz.quz', {}, () => {
                return mockResponseWith({'expir':'ed'});
            });
        }).then(res => {
            assert.equal(res.headers.expir, 'ed');
        });
    });

    it('cache error per url', function() {
        const cache = new Cache();
        return cache.getCached('http://foo.bar/baz.quz', {}, () => {
            throw Error("test");
        }).then(res => assert.fail("nope", res), err => {
            assert.equal("test", err.message);
        }).then(() => {
            return cache.getCached('http://foo.bar/baz.quz?', {}, () => {
                return mockResponseWith({'got':'it'});
            });
        }).then(res => {
            assert(res.headers);
            assert.equal(res.headers.got, 'it');
        });
    });

    it('miss private cache', function() {
        const cache = new Cache();
        let called = 0;
        return cache.getCached('http://foo.bar/baz.quz', {}, reqOpts => {
            assert(reqOpts);
            called++;
            return mockResponseWith({
                'cache-control': 'private, max-age=999999',
            });
        }).then(res => {
            assert(res.testedObject);
            return cache.getCached('http://foo.bar/baz.quz', {}, () => {
                called++;
                return mockResponseWith({
                    'cache-control': 'private, max-age=333',
                    'second': 'yes',
                });
            });
        }).then(res => {
            assert(res.testedObject);
            assert.equal(2, called);
            assert.equal(res.headers.second, 'yes');
        });
    });

    it('miss cookie', function() {
        const cache = new Cache();
        let called = 0;
        return cache.getCached('http://foo.bar/baz.quz', {}, reqOpts => {
            assert(reqOpts);
            called++;
            return mockResponseWith({
                'set-cookie': 'foo=bar',
                'cache-control': 'max-age=99',
            });
        }).then(() => {
            return cache.getCached('http://foo.bar/baz.quz', {}, () => {
                called++;
                return mockResponseWith({
                    'second': 'yes',
                });
            });
        }).then(res => {
            assert(res.testedObject);
            assert.equal(2, called);
            assert.equal(res.headers.second, 'yes');
        });
    });

    it('cache public cookie', function() {
        const cache = new Cache();
        let called = 0;
        return cache.getCached('http://foo.bar/baz.quz', {}, reqOpts => {
            assert(reqOpts);
            called++;
            return mockResponseWith({
                'set-cookie': 'foo=bar',
                'cache-control': 'public, max-age=99',
            });
        }).then(res => {
            return cache.getCached('http://foo.bar/baz.quz', {}, () => {
                assert.fail("should cache")
            });
        }).then(res => {
            assert(res.testedObject);
            assert.equal(1, called);
            assert.equal(res.headers['set-cookie'], 'foo=bar');
        });
    });

    it('miss max-age=0', function() {
        const cache = new Cache();
        let called = 0;
        return cache.getCached('http://foo.bar/baz.quz', {}, reqOpts => {
            assert(reqOpts);
            called++;
            return mockResponseWith({
                'cache-control': 'public, max-age=0',
            });
        }).then(res => {
            assert(res.testedObject);
            return cache.getCached('http://foo.bar/baz.quz', {}, () => {
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

    it('miss expires', function() {
        const cache = new Cache();
        let called = 0;
        return cache.getCached('http://foo.bar/baz.quz', {}, reqOpts => {
            assert(reqOpts);
            called++;
            return mockResponseWith({
                'cache-control': 'public, max-age=9999',
                'expires': 'Sat, 07 May 2016 15:35:18 GMT',
            });
        }).then(res => {
            assert(res.testedObject);
            return cache.getCached('http://foo.bar/baz.quz', {}, () => {
                called++;
                return mockResponseWith({
                    'cache-control': 'public, max-age=333',
                    'expires': new Date(Date.now()+3600*1000).toGMTString(),
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
