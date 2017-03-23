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
