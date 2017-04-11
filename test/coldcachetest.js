'use strict';

const assert = require('assert');
const Cache = require('..');

const req = {
    headers: {},
}

function mockResponseWith(headers) {
    return {
        status: 200,
        testedObject:true,
        body: new Buffer(`bodyof${JSON.stringify(headers)}`),
        headers,
    };
}

describe('Cold cache', function() {
    const leakyBucket = {
        get() {},
        set() {},
        del() {},
    };
    let s;
    beforeEach(() => {
        s = new Map();
    });
    const coldStorage = {
        get(key) {
            return Promise.resolve(s.get(key));
        },
        set(key, v) {
            s.set(key, v);
            return Promise.resolve();
        },
        del(key) {
            s.delete(key);
            return Promise.resolve();
        }
    };

    it('simple miss', async function() {
        const cache = new Cache({storage:leakyBucket});
        let called = false;
        const res = await cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            called = true;
            return mockResponseWith({});
        });
        assert(called);
        assert(res);
        assert(res.testedObject);
    });


    it('miss without cache', async function() {
        const cache = new Cache({storage:leakyBucket});
        let called = 0;
        const res = await cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'cache-control': 'public, max-age=999999',
                'old': 'yes',
            })
        })
        assert(res.testedObject);
        const tmp = await Promise.all([
            cache.getCached('http://foo.bar/baz.quz', req, () => {
                called++;
                return mockResponseWith({
                    old: 'no',
                });
            }),
            cache.getCached('https://foo.bar/baz.quz', req, () => {
                called++;
                return mockResponseWith({});
            }),
        ]);
        assert(tmp[0].testedObject);
        assert(tmp[1].testedObject);
        assert.equal(tmp[0].headers.old, 'no');
        assert.equal(2, called);
    });

    it('miss without cache2', async function() {
        const cache = new Cache();
        let called = 0;
        const res = await cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'cache-control': 'public, max-age=999999',
                'old': 'yes',
            })
        })
        await cache.purge();
        assert(res.testedObject);
        const tmp = await Promise.all([
            cache.getCached('http://foo.bar/baz.quz', req, () => {
                called++;
                return mockResponseWith({
                    old: 'no',
                });
            }),
            cache.getCached('https://foo.bar/baz.quz', req, () => {
                called++;
                return mockResponseWith({});
            }),
        ]);
        assert(tmp[0].testedObject);
        assert(tmp[1].testedObject);
        assert.equal(tmp[0].headers.old, 'no');
        assert.equal(2, called);
    });

    it('hit with cold cache', async function() {
        const cache = new Cache({coldStorage});
        let missInParallelCalled = false;
        await cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'cache-control': 'public, max-age=999999',
                'try': 'first',
            });
        })
        const res = await cache.getCached('http://foo.bar/baz.quz', req, opt => assert.fail("should cache", opt));
        await cache.purge();
        assert(res.testedObject);
        const tmp = await Promise.all([
            cache.getCached('http://foo.bar/baz.quz', req, opt => assert.fail("should cache", opt)),
            cache.getCached('https://foo.bar/baz.quz', req, reqOpts => {
                assert(reqOpts);
                missInParallelCalled = true;
                return mockResponseWith({});
            }),
        ]);
        assert(tmp[0].testedObject);
        assert(tmp[1].testedObject);
        assert.equal(tmp[0].headers.try, 'first');
        assert.equal(tmp[0].body.toString(), 'bodyof{"cache-control":"public, max-age=999999","try":"first"}');
        assert(missInParallelCalled);
    });

    it('hit with new cache', async function() {
        const cache1 = new Cache({coldStorage});
        await Promise.all([
            cache1.getCached('http://test.local/long', req, () => {
                return mockResponseWith({
                    'cache-control': 'public, max-age=6666',
                    'cached': 'yeah',
                });
            }),
            cache1.getCached('http://test.local/long', req, opt => assert.fail("should cache", opt)),
        ]);
        const cache2 = new Cache({coldStorage});
        const res = await cache2.getCached('http://test.local/long', req, opt => assert.fail("should cache", opt));
        assert(res.testedObject);
        assert.equal(res.headers.cached, 'yeah');
        assert.equal(res.body.toString(), 'bodyof{"cache-control":"public, max-age=6666","cached":"yeah"}');
    });

    it('hit with cold cache via dump', async function() {
        const cache = new Cache({coldStorage});
        await cache.getCached('http://example.com/dispose', req, () => {
            return mockResponseWith({
                'cache-control': 'public, max-age=22444',
                'try': 'disposed',
            });
        });
        await cache.dump();

        const cache2 = new Cache({coldStorage});
        const res = await cache2.getCached('http://example.com/dispose', req, opt => assert.fail("should cache", opt));
        assert(res.testedObject);
        assert.equal(res.headers.try, 'disposed');
        assert.equal(res.body.toString(), 'bodyof{"cache-control":"public, max-age=22444","try":"disposed"}');
    });

    it('hit with cold cache via dispose', async function() {
        const cache = new Cache({coldStorage});
        await cache.getCached('http://example.com/dispose', req, () => {
            return mockResponseWith({
                'cache-control': 'public, max-age=22444',
                'try': 'disposed',
            });
        });
        await cache.purge();
        const res = await cache.getCached('http://example.com/dispose', req, opt => assert.fail("should cache", opt));
        assert(res.testedObject);
        assert.equal(res.headers.try, 'disposed');
        assert.equal(res.body.toString(), 'bodyof{"cache-control":"public, max-age=22444","try":"disposed"}');
    });

    it('miss with cold cache', async function() {
        const cache = new Cache({coldStorage});
        let missInParallelCalled = false;
        await cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'cache-control': 'public, max-age=0',
                'try': 'first',
            });
        });
        const res = await cache.getCached('http://foo.bar/baz.quz', req, () => mockResponseWith({
            'cache-control': 'public, max-age=0',
            'try': 'second',
        }));
        await cache.purge();
        assert(res.testedObject);
        const tmp = await Promise.all([
            cache.getCached('http://foo.bar/baz.quz', req, () => mockResponseWith({
                'cache-control': 'public, max-age=10',
                'try': 'third',
            })),
            cache.getCached('https://foo.bar/baz.quz', req, reqOpts => {
                assert(reqOpts);
                missInParallelCalled = true;
                return mockResponseWith({});
            }),
        ]);
        assert(tmp[0].testedObject);
        assert(tmp[1].testedObject);
        assert.equal(tmp[0].headers.try, 'third');
        assert.equal(tmp[0].body.toString(), 'bodyof{"cache-control":"public, max-age=10","try":"third"}');
        assert(missInParallelCalled);
    });
});
