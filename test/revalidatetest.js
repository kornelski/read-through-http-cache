'use strict';

const assert = require('assert');
const Cache = require('..');
const CachePolicy = require('http-cache-semantics');

const req = {
    headers: {
        'if-modified-since': 'Tue, 21 Mar 2017 19:14:36 GMT',
        'x-other-header': 'Too',
        'user-agent': 'Foobar/1.0',
    },
}

function mockResponseWith(headers, status = 200, body = "") {
    return {
        status,
        testedObject:true,
        body,
        headers,
    };
}

describe('Revalidate', function() {
    it('simple miss', async function() {
        const cache = new Cache();
        let called = false;
        const res = await cache.getCached('http://foo.bar/baz.quz', req, revalidateHeaders => {
            assert(!revalidateHeaders['if-modified-since']);
            called = true;
            return mockResponseWith({});
        });
        assert(called);
        assert(res);
        assert(res.testedObject);
    });

    it('304 must be for cached', async function() {
        const cache = new Cache();
        try {
            const res = await cache.getCached('http://foo.bar/baz.quz', req, revalidateHeaders => {
                assert(!revalidateHeaders['if-modified-since']);
                return mockResponseWith({
                    'cache-control': 'public, max-age=999999',
                    'last-modified': 'Tue, 21 Mar 2017 19:14:36 GMT',
                }, 304);
            });
            assert.fail("should reject", res);
        } catch(err) {
            assert(/revalidation/.test(err.message), err);
        }
    });

    it('check with etag', async function() {
        let now = Date.now();
        const cache = new Cache({CachePolicy: class MyCachePolicy extends CachePolicy {now(){return now}}});

        await cache.getCached('http://foo.bar/baz.quz', req, () => {
            return mockResponseWith({
                'date': new Date().toGMTString(),
                'expires': new Date(Date.now() + 2000).toGMTString(),
                'etag': '"foo"',
            }, 200, "origbody");
        });

        now += 4000;

        let called = false;
        const res = await cache.getCached('http://foo.bar/baz.quz', req, revalidateHeaders => {
            called = true;
            assert.equal('"foo"', revalidateHeaders['if-none-match']);
            return mockResponseWith({'res':'new', 'etag': '"foo"'}, 304, undefined);
        });
        assert(called);
        assert(res);
        assert(res.headers);
        assert.equal('"foo"', res.headers.etag);
        assert.equal('origbody', res.body);
    });

    it('concurrent revalidation and non-revalidation', async function() {
        const cache = new Cache();

        const noRevalReq = Object.assign({}, req, {'if-modified-since':undefined});
        const req1Promise = cache.getCached('http://foo.bar/baz.quz', req, revalHeaders => {
            return mockResponseWith({"cache-control":'no-cache'}, 200, "req1");
        });
        req1Promise.catch(() => 'shut up node');

        const req2Promise = cache.getCached('http://foo.bar/baz.quz', req, revalHeaders => {
            assert(revalHeaders['if-modified-since']);
            return mockResponseWith(revalHeaders, 304, "req2");
        });
        req2Promise.catch(() => 'shut up node');

        const req3 = await cache.getCached('http://foo.bar/baz.quz', noRevalReq, revalHeaders => {
            assert(revalHeaders['if-modified-since']);
            return mockResponseWith(revalHeaders, 304, "req3");
        });
        const req1 = await req1Promise;
        const req2 = await req2Promise;
        assert.equal("req1",req1.body)
        assert.equal("req1",req2.body)
        assert.equal("req1",req3.body)
    });

    it('check with last-modified', async function() {
        let now = Date.now();
        const cache = new Cache({CachePolicy: class MyCachePolicy extends CachePolicy {now(){return now}}});

        await cache.getCached('http://foo.bar/baz.quz', req, () => {
            return mockResponseWith({
                'date': new Date().toGMTString(),
                'cache-control': 'max-age=2',
                'res': 'old',
                'prev': 'yes',
                'last-modified': 'Tue, 21 Mar 2017 19:14:36 GMT',
            }, 200, "oldbody");
        });

        now += 4000;

        let called = false;
        const res = await cache.getCached('http://foo.bar/baz.quz', req, revalidateHeaders => {
            called = true;
            assert(!revalidateHeaders['if-none-match']);
            assert.equal('Tue, 21 Mar 2017 19:14:36 GMT', revalidateHeaders['if-modified-since']);
            return mockResponseWith({'res':'new', 'next': 'yes', 'last-modified': 'Tue, 21 Mar 2017 19:14:36 GMT'}, 304, undefined);
        });
        assert(called);
        assert(res);
        assert(res.headers);
        assert.equal('oldbody', res.body);
        assert.equal('new', res.headers.res);
        assert.equal('yes', res.headers.prev);
    });
});
