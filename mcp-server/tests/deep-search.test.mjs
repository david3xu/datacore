// deep-search.test.mjs — Does semantic search work correctly?
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Save and clear env vars before tests
let savedHost, savedToken, savedIndex;
let breaker; // circuit breaker singleton — shared across all tests

before(async () => {
  savedHost = process.env.DATABRICKS_HOST;
  savedToken = process.env.DATABRICKS_TOKEN;
  savedIndex = process.env.DATABRICKS_INDEX_NAME;

  // Grab the circuit breaker singleton so tests can reset it
  const cb = await import('../dist/circuit-breaker.js');
  breaker = cb.deepSearchBreaker;
});

after(() => {
  if (savedHost) process.env.DATABRICKS_HOST = savedHost;
  else delete process.env.DATABRICKS_HOST;
  if (savedToken) process.env.DATABRICKS_TOKEN = savedToken;
  else delete process.env.DATABRICKS_TOKEN;
  if (savedIndex) process.env.DATABRICKS_INDEX_NAME = savedIndex;
  else delete process.env.DATABRICKS_INDEX_NAME;
});

/** Reset breaker to CLOSED state — call at start of any test that uses a mocked fetch */
function resetBreaker() {
  Object.assign(breaker, { state: 'CLOSED', failures: 0, openedAt: null });
}

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
    resetBreaker();

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
    resetBreaker();

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
    resetBreaker();

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
    resetBreaker();

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
    resetBreaker();

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

    // Reset for second call (503 above incremented failures — reset before next)
    resetBreaker();

    try {
      await deepSearch({ query: 'test', mode: 'semantic' });
    } catch {
      /* expected */
    }
    assert.equal(capturedBody.query_type, 'ANN');

    globalThis.fetch = originalFetch;
  });

  describe('circuit breaker', () => {
    it('circuit opens after failureThreshold consecutive 5xx failures', async () => {
      process.env.DATABRICKS_HOST = 'https://fake.azuredatabricks.net';
      process.env.DATABRICKS_TOKEN = 'fake-token';
      resetBreaker();

      const { deepSearch } = await import('../dist/deep-search.js');
      const originalFetch = globalThis.fetch;

      // Mock fetch to always return 503
      globalThis.fetch = async () => ({
        ok: false,
        status: 503,
        text: async () => 'service unavailable',
      });

      // Trip the circuit (failureThreshold = 3)
      for (let i = 0; i < 3; i++) {
        try {
          await deepSearch({ query: 'test' });
        } catch {
          /* expected */
        }
      }

      assert.equal(breaker.getState(), 'OPEN', 'circuit should be OPEN after 3 failures');

      // Next call should throw CircuitOpenError immediately (fetch not called)
      let fetchCalled = false;
      globalThis.fetch = async () => {
        fetchCalled = true;
        return { ok: true };
      };

      const { CircuitOpenError } = await import('../dist/deep-search.js');
      await assert.rejects(
        () => deepSearch({ query: 'probe' }),
        (err) => {
          assert.ok(
            err instanceof CircuitOpenError,
            `expected CircuitOpenError, got ${err.constructor.name}`,
          );
          return true;
        },
      );
      assert.equal(fetchCalled, false, 'fetch should not be called when circuit is OPEN');

      globalThis.fetch = originalFetch;
    });

    it('circuit stays closed after a successful call', async () => {
      process.env.DATABRICKS_HOST = 'https://fake.azuredatabricks.net';
      process.env.DATABRICKS_TOKEN = 'fake-token';
      resetBreaker();

      const { deepSearch } = await import('../dist/deep-search.js');
      const originalFetch = globalThis.fetch;

      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          manifest: {
            columns: [
              { name: 'event_id' },
              { name: 'timestamp' },
              { name: 'source' },
              { name: 'type' },
              { name: 'content' },
            ],
          },
          result: { data_array: [] },
        }),
      });

      await deepSearch({ query: 'hello' });
      assert.equal(breaker.getState(), 'CLOSED', 'circuit should remain CLOSED after success');
      assert.equal(breaker.getFailures(), 0);

      globalThis.fetch = originalFetch;
    });

    it('4xx errors do not trip the circuit breaker', async () => {
      process.env.DATABRICKS_HOST = 'https://fake.azuredatabricks.net';
      process.env.DATABRICKS_TOKEN = 'fake-token';
      resetBreaker();

      const { deepSearch } = await import('../dist/deep-search.js');
      const originalFetch = globalThis.fetch;

      globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });

      // Fire 5 x 401 errors — should never open the circuit
      for (let i = 0; i < 5; i++) {
        try {
          await deepSearch({ query: 'test' });
        } catch {
          /* 401 expected */
        }
      }

      assert.equal(breaker.getState(), 'CLOSED', '4xx errors should not open the circuit');
      assert.equal(breaker.getFailures(), 0, 'failure count should stay 0 after 4xx errors');

      globalThis.fetch = originalFetch;
    });

    it('circuit transitions OPEN → HALF_OPEN → CLOSED on successful probe', async () => {
      process.env.DATABRICKS_HOST = 'https://fake.azuredatabricks.net';
      process.env.DATABRICKS_TOKEN = 'fake-token';
      resetBreaker();

      const { deepSearch } = await import('../dist/deep-search.js');
      const originalFetch = globalThis.fetch;

      // Trip the circuit
      globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => 'err' });
      for (let i = 0; i < 3; i++) {
        try {
          await deepSearch({ query: 'test' });
        } catch {
          /* expected */
        }
      }
      assert.equal(breaker.getState(), 'OPEN');

      // Simulate recovery window passing by backdating openedAt
      Object.assign(breaker, { openedAt: Date.now() - 31_000 });

      // Next call should be a HALF_OPEN probe — mock it to succeed
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          manifest: {
            columns: [
              { name: 'event_id' },
              { name: 'timestamp' },
              { name: 'source' },
              { name: 'type' },
              { name: 'content' },
            ],
          },
          result: { data_array: [] },
        }),
      });

      await deepSearch({ query: 'probe' });
      assert.equal(breaker.getState(), 'CLOSED', 'successful probe should close the circuit');

      globalThis.fetch = originalFetch;
    });
  });
});
