'use strict';

const assert = require('assert');
const Cache = require('..');

const req = {
    headers: {},
}

function mockResponseWith(headers) {
    return {
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

    it('simple miss', function() {
        const cache = new Cache({storage:leakyBucket});
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


    it('miss without cache', function() {
        const cache = new Cache({storage:leakyBucket});
        let called = 0;
        return cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'cache-control': 'public, max-age=999999',
                'old': 'yes',
            })
        }).then(res => {
            assert(res.testedObject);
            return Promise.all([
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
        }).then(tmp => {
            assert(tmp[0].testedObject);
            assert(tmp[1].testedObject);
            assert.equal(tmp[0].headers.old, 'no');
            assert.equal(2, called);
        });
    });

    it('miss without cache2', function() {
        const cache = new Cache();
        let called = 0;
        return cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'cache-control': 'public, max-age=999999',
                'old': 'yes',
            })
        }).then(res => {
            cache._storage.reset();
            assert(res.testedObject);
            return Promise.all([
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
        }).then(tmp => {
            assert(tmp[0].testedObject);
            assert(tmp[1].testedObject);
            assert.equal(tmp[0].headers.old, 'no');
            assert.equal(2, called);
        });
    });

    it('hit with cold cache', function() {
        const cache = new Cache({coldStorage});
        let missInParallelCalled = false;
        return cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'cache-control': 'public, max-age=999999',
                'try': 'first',
            });
        })
        .then(() => cache.getCached('http://foo.bar/baz.quz', req, opt => assert.fail("should cache", opt)))
        .then(res => {
            cache._storage.reset();
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
            assert.equal(tmp[0].headers.try, 'first');
            assert.equal(tmp[0].body.toString(), 'bodyof{"cache-control":"public, max-age=999999","try":"first"}');
            assert(missInParallelCalled);
        });
    });

    it('hit with new cache', function() {
        const cache1 = new Cache({coldStorage});
        return Promise.all([
            cache1.getCached('http://test.local/long', req, () => {
                return mockResponseWith({
                    'cache-control': 'public, max-age=6666',
                    'cached': 'yeah',
                });
            }),
            cache1.getCached('http://test.local/long', req, opt => assert.fail("should cache", opt)),
        ])
        .then(() => {
            const cache2 = new Cache({coldStorage});
            return cache2.getCached('http://test.local/long', req, opt => assert.fail("should cache", opt));
        }).then(res => {
            assert(res.testedObject);
            assert.equal(res.headers.cached, 'yeah');
            assert.equal(res.body.toString(), 'bodyof{"cache-control":"public, max-age=6666","cached":"yeah"}');
        });
    });

    it('hit with cold cache via dispose', function() {
        const cache = new Cache({coldStorage});
        return cache.getCached('http://example.com/dispose', req, () => {
            return mockResponseWith({
                'cache-control': 'public, max-age=444',
                'try': 'disposed',
            });
        })
        .then(() => cache._storage.reset())
        .then(() => cache.getCached('http://example.com/dispose', req, opt => assert.fail("should cache", opt)))
        .then(res => {
            assert(res.testedObject);
            assert.equal(res.headers.try, 'disposed');
            assert.equal(res.body.toString(), 'bodyof{"cache-control":"public, max-age=444","try":"disposed"}');
        });
    });

    it('miss with cold cache', function() {
        const cache = new Cache({coldStorage});
        let missInParallelCalled = false;
        return cache.getCached('http://foo.bar/baz.quz', req, reqOpts => {
            assert(reqOpts);
            return mockResponseWith({
                'cache-control': 'public, max-age=0',
                'try': 'first',
            });
        })
        .then(() => cache.getCached('http://foo.bar/baz.quz', req, () => mockResponseWith({
            'cache-control': 'public, max-age=0',
            'try': 'second',
        })))
        .then(res => {
            cache._storage.reset();
            assert(res.testedObject);
            return Promise.all([
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
        }).then(tmp => {
            assert(tmp[0].testedObject);
            assert(tmp[1].testedObject);
            assert.equal(tmp[0].headers.try, 'third');
            assert.equal(tmp[0].body.toString(), 'bodyof{"cache-control":"public, max-age=10","try":"third"}');
            assert(missInParallelCalled);
        });
    });
});
