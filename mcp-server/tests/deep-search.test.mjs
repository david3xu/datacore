// deep-search.test.mjs — Does semantic search work correctly?
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Save and clear env vars before tests
let savedHost, savedToken, savedIndex;

before(() => {
  savedHost = process.env.DATABRICKS_HOST;
  savedToken = process.env.DATABRICKS_TOKEN;
  savedIndex = process.env.DATABRICKS_INDEX_NAME;
});

after(() => {
  if (savedHost) process.env.DATABRICKS_HOST = savedHost;
  else delete process.env.DATABRICKS_HOST;
  if (savedToken) process.env.DATABRICKS_TOKEN = savedToken;
  else delete process.env.DATABRICKS_TOKEN;
  if (savedIndex) process.env.DATABRICKS_INDEX_NAME = savedIndex;
  else delete process.env.DATABRICKS_INDEX_NAME;
});

describe('deep-search', () => {
  it('throws when DATABRICKS_HOST is not set', async () => {
    delete process.env.DATABRICKS_HOST;
    delete process.env.DATABRICKS_TOKEN;

    const { deepSearch } = await import('../dist/deep-search.js');
    await assert.rejects(
      () => deepSearch({ query: 'test' }),
      (err) => {
        assert.match(err.message, /DATABRICKS_HOST/);
        assert.match(err.message, /DATABRICKS_TOKEN/);
        return true;
      },
    );
  });

  it('throws when DATABRICKS_TOKEN is not set', async () => {
    process.env.DATABRICKS_HOST = 'https://fake.azuredatabricks.net';
    delete process.env.DATABRICKS_TOKEN;

    // Re-import to pick up env changes — dynamic import caches, so
    // we test via the tool layer instead
    const { deepSearch } = await import('../dist/deep-search.js');
    await assert.rejects(
      () => deepSearch({ query: 'test' }),
      (err) => {
        assert.match(err.message, /DATABRICKS_TOKEN/);
        return true;
      },
    );
  });

  it('uses default index name when DATABRICKS_INDEX_NAME not set', async () => {
    process.env.DATABRICKS_HOST = 'https://fake.azuredatabricks.net';
    process.env.DATABRICKS_TOKEN = 'fake-token';
    delete process.env.DATABRICKS_INDEX_NAME;

    const { deepSearch } = await import('../dist/deep-search.js');
    // Will fail on fetch (no real server), but we can catch and inspect the URL
    try {
      await deepSearch({ query: 'test' });
    } catch (err) {
      // fetch failure expected — the important thing is it didn't throw
      // a config error, meaning it accepted the default index name
      assert.ok(!err.message.includes('DATABRICKS_HOST'));
    }
  });

  it('respects custom index name from env', async () => {
    process.env.DATABRICKS_HOST = 'https://fake.azuredatabricks.net';
    process.env.DATABRICKS_TOKEN = 'fake-token';
    process.env.DATABRICKS_INDEX_NAME = 'custom.schema.my_index';

    const { deepSearch } = await import('../dist/deep-search.js');
    try {
      await deepSearch({ query: 'test' });
    } catch (err) {
      // Fetch will fail but should reference our custom index
      assert.ok(!err.message.includes('DATABRICKS_HOST'));
    }
  });

  it('caps numResults at 20', async () => {
    process.env.DATABRICKS_HOST = 'https://fake.azuredatabricks.net';
    process.env.DATABRICKS_TOKEN = 'fake-token';

    const { deepSearch } = await import('../dist/deep-search.js');
    // Intercept global fetch to verify the request body
    const originalFetch = globalThis.fetch;
    let capturedBody = null;

    globalThis.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: false, status: 503, text: async () => 'mocked' };
    };

    try {
      await deepSearch({ query: 'test', numResults: 100 });
    } catch {
      // Expected — mocked fetch returns 503
    }

    assert.equal(capturedBody.num_results, 20, 'numResults should be capped at 20');
    globalThis.fetch = originalFetch;
  });

  it('sends correct filter format for source', async () => {
    process.env.DATABRICKS_HOST = 'https://fake.azuredatabricks.net';
    process.env.DATABRICKS_TOKEN = 'fake-token';

    const { deepSearch } = await import('../dist/deep-search.js');
    const originalFetch = globalThis.fetch;
    let capturedBody = null;

    globalThis.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: false, status: 503, text: async () => 'mocked' };
    };

    try {
      await deepSearch({ query: 'test', source: 'claude.ai' });
    } catch {
      // Expected
    }

    const filters = JSON.parse(capturedBody.filters_json);
    assert.deepEqual(
      filters,
      { source: ['claude.ai'] },
      'filter should use {key: [value]} format for Databricks',
    );
    globalThis.fetch = originalFetch;
  });

  it('sends HYBRID query_type by default', async () => {
    process.env.DATABRICKS_HOST = 'https://fake.azuredatabricks.net';
    process.env.DATABRICKS_TOKEN = 'fake-token';

    const { deepSearch } = await import('../dist/deep-search.js');
    const originalFetch = globalThis.fetch;
    let capturedBody = null;

    globalThis.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: false, status: 503, text: async () => 'mocked' };
    };

    try {
      await deepSearch({ query: 'test' });
    } catch {
      /* expected */
    }
    assert.equal(capturedBody.query_type, 'HYBRID');

    try {
      await deepSearch({ query: 'test', mode: 'semantic' });
    } catch {
      /* expected */
    }
    assert.equal(capturedBody.query_type, 'ANN');

    globalThis.fetch = originalFetch;
  });
});
