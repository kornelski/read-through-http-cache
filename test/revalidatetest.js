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

function mockResponseWith(headers, status = 200) {
    return {
        status,
        testedObject:true,
        body: new Buffer(0),
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

    it('304 not cacheable', async function() {
        const cache = new Cache();
        let called = false;
        await cache.getCached('http://foo.bar/baz.quz', req, revalidateHeaders => {
            assert(!revalidateHeaders['if-modified-since']);
            return mockResponseWith({
                'cache-control': 'public, max-age=999999',
                'last-modified': 'Tue, 21 Mar 2017 19:14:36 GMT',
            }, 304);
        });
        const res = await cache.getCached('http://foo.bar/baz.quz', req, revalidateHeaders => {
            assert(!revalidateHeaders['if-modified-since']);
            called = true;
            return mockResponseWith({}, 304);
        });
        assert(called);
        assert(res);
        assert(res.testedObject);
    });

    it('check with etag', async function() {
        let now = Date.now();
        const cache = new Cache({CachePolicy: class MyCachePolicy extends CachePolicy {now(){return now}}});

        await cache.getCached('http://foo.bar/baz.quz', req, () => {
            return mockResponseWith({
                'date': new Date().toGMTString(),
                'expires': new Date(Date.now() + 2000).toGMTString(),
                'etag': '"foo"',
            });
        });

        now += 4000;

        let called = false;
        await cache.getCached('http://foo.bar/baz.quz', req, revalidateHeaders => {
            called = true;
            assert.equal('"foo"', revalidateHeaders['if-none-match']);
        });
        assert(called);
    });

    it('check with last-modified', async function() {
        let now = Date.now();
        const cache = new Cache({CachePolicy: class MyCachePolicy extends CachePolicy {now(){return now}}});

        await cache.getCached('http://foo.bar/baz.quz', req, () => {
            return mockResponseWith({
                'date': new Date().toGMTString(),
                'cache-control': 'max-age=2',
                'last-modified': 'Tue, 21 Mar 2017 19:14:36 GMT',
            });
        });

        now += 4000;

        let called = false;
        await cache.getCached('http://foo.bar/baz.quz', req, revalidateHeaders => {
            called = true;
            assert(!revalidateHeaders['if-none-match']);
            assert.equal('Tue, 21 Mar 2017 19:14:36 GMT', revalidateHeaders['if-modified-since']);
        });
        assert(called);
    });
});
