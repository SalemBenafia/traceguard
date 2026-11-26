import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyPrivacyUpdates,
  collectReportedAccounts,
  isAccountId,
  planPrivacyActions,
  REPORT_BATCH_SIZE,
} from '../src/engine/privacy.js';

function fakeStore() {
  const calls = [];
  return {
    calls,
    anonymiseOwners: async (ids) => calls.push(['anonymise', ids]),
    clearOwnerTeams: async (ids) => calls.push(['clearTeams', ids]),
    deleteCachedTeam: async (id) => calls.push(['deleteCache', id]),
  };
}

describe('planPrivacyActions', () => {
  test('closed accounts are erased and updated accounts are refreshed', () => {
    const plan = planPrivacyActions([
      { accountId: 'acc-1', status: 'closed' },
      { accountId: 'acc-2', status: 'updated' },
    ]);

    assert.deepEqual(plan, { erase: ['acc-1'], refresh: ['acc-2'] });
  });

  test('an account reported as closed and updated is only erased', () => {
    const plan = planPrivacyActions([
      { accountId: 'acc-1', status: 'updated' },
      { accountId: 'acc-1', status: 'closed' },
    ]);

    assert.deepEqual(plan, { erase: ['acc-1'], refresh: [] });
  });

  test('repeated accounts are handled once', () => {
    const plan = planPrivacyActions([
      { accountId: 'acc-1', status: 'closed' },
      { accountId: 'acc-1', status: 'closed' },
    ]);

    assert.deepEqual(plan.erase, ['acc-1']);
  });

  test('unknown statuses and invalid account ids are ignored', () => {
    const plan = planPrivacyActions([
      { accountId: 'acc-1', status: 'deleted' },
      { accountId: '', status: 'closed' },
      { accountId: 'has space', status: 'closed' },
      { status: 'closed' },
      null,
    ]);

    assert.deepEqual(plan, { erase: [], refresh: [] });
  });

  test('no updates means no actions', () => {
    assert.deepEqual(planPrivacyActions([]), { erase: [], refresh: [] });
    assert.deepEqual(planPrivacyActions(undefined), { erase: [], refresh: [] });
  });
});

describe('applyPrivacyUpdates', () => {
  test('erase anonymises stored owners and deletes the team cache', async () => {
    const store = fakeStore();
    const result = await applyPrivacyUpdates([{ accountId: 'acc-1', status: 'closed' }], store);

    assert.deepEqual(result, { erased: 1, refreshed: 0 });
    assert.deepEqual(store.calls, [
      ['anonymise', ['acc-1']],
      ['deleteCache', 'acc-1'],
    ]);
  });

  test('refresh clears saved teams and the team cache, without anonymising', async () => {
    const store = fakeStore();
    const result = await applyPrivacyUpdates([{ accountId: 'acc-2', status: 'updated' }], store);

    assert.deepEqual(result, { erased: 0, refreshed: 1 });
    assert.deepEqual(store.calls, [
      ['clearTeams', ['acc-2']],
      ['deleteCache', 'acc-2'],
    ]);
  });

  test('mixed updates erase first, then refresh, then delete every cache entry', async () => {
    const store = fakeStore();
    await applyPrivacyUpdates(
      [
        { accountId: 'acc-2', status: 'updated' },
        { accountId: 'acc-1', status: 'closed' },
      ],
      store,
    );

    assert.deepEqual(store.calls, [
      ['anonymise', ['acc-1']],
      ['clearTeams', ['acc-2']],
      ['deleteCache', 'acc-1'],
      ['deleteCache', 'acc-2'],
    ]);
  });

  test('no updates touch no data', async () => {
    const store = fakeStore();

    assert.deepEqual(await applyPrivacyUpdates([], store), { erased: 0, refreshed: 0 });
    assert.deepEqual(store.calls, []);
  });

  test('a storage failure stops the job so it can try again tomorrow', async () => {
    const store = { ...fakeStore(), anonymiseOwners: async () => { throw new Error('down'); } };

    await assert.rejects(applyPrivacyUpdates([{ accountId: 'acc-1', status: 'closed' }], store), /down/);
  });
});

describe('collectReportedAccounts', () => {
  test('reports each account once with its oldest retrieval time', () => {
    const accounts = collectReportedAccounts({
      storedOwners: [{ owner_account_id: 'acc-1', oldest_scanned_at: '2026-11-20 10:00:00' }],
      cachedTeams: [
        { accountId: 'acc-1', cachedAt: Date.parse('2026-11-19T08:00:00Z') },
        { accountId: 'acc-2', cachedAt: Date.parse('2026-11-21T09:30:00Z') },
      ],
    });

    assert.deepEqual(accounts, [
      { accountId: 'acc-1', updatedAt: '2026-11-19T08:00:00.000Z' },
      { accountId: 'acc-2', updatedAt: '2026-11-21T09:30:00.000Z' },
    ]);
  });

  test('saved scan times are read as UTC', () => {
    const [account] = collectReportedAccounts({
      storedOwners: [{ owner_account_id: 'acc-1', oldest_scanned_at: '2026-11-20 10:00:00' }],
    });

    assert.equal(account.updatedAt, '2026-11-20T10:00:00.000Z');
  });

  test('an unknown retrieval time is reported as the oldest possible time', () => {
    const accounts = collectReportedAccounts({
      storedOwners: [{ owner_account_id: 'acc-1', oldest_scanned_at: null }],
      cachedTeams: [{ accountId: 'acc-2', cachedAt: undefined }],
    });

    assert.deepEqual(accounts.map((account) => account.updatedAt), [
      '1970-01-01T00:00:00.000Z',
      '1970-01-01T00:00:00.000Z',
    ]);
  });

  test('invalid account ids are not reported', () => {
    const accounts = collectReportedAccounts({
      storedOwners: [{ owner_account_id: null }, { owner_account_id: 'bad id' }],
      cachedTeams: [{ accountId: '' }],
    });

    assert.deepEqual(accounts, []);
  });
});

test('Atlassian account ids are accepted', () => {
  assert.equal(isAccountId('5be24ad8b1653240376955d2'), true);
  assert.equal(isAccountId('712020:5fb4febc-facf-d600-76a1-c699a1b2c3d4'), true);
  assert.equal(REPORT_BATCH_SIZE, 90);
});
