import { describe, it, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import {
  writeAgentState,
  advanceTurn,
  cleanStoppedAgents,
  cleanAllAgents,
  cleanSessionState,
} from '../dist/state.js';

// ── Helpers ──

function uniqueSessionId() {
  const hex = Math.random().toString(16).slice(2, 10);
  const hex2 = Date.now().toString(16);
  return `${hex2}-${hex}-bcc0`;
}

function makeAgent(sessionId, agentId, overrides = {}) {
  const now = new Date().toISOString();
  return {
    agentId,
    sessionId,
    status: 'active',
    subagentType: null,
    model: null,
    description: null,
    startedAt: now,
    stoppedAt: null,
    approxTokens: 0,
    approxInputTokens: 0,
    approxOutputTokens: 0,
    toolUseCount: 0,
    lastUpdated: now,
    turnNumber: 0,
    ...overrides,
  };
}

const CANONICAL_BASE = join(homedir(), '.claude-cli-monitor', 'state');
const LEGACY_BASE = join(homedir(), '.claude-agent-monitor', 'state');

function canonicalAgentPath(sid, aid) {
  return join(CANONICAL_BASE, sid, `agent-${aid}.json`);
}
function legacyAgentPath(sid, aid) {
  return join(LEGACY_BASE, sid, `agent-${aid}.json`);
}
function canonicalTurnMarkerPath(sid) {
  return join(CANONICAL_BASE, sid, 'turn-marker.json');
}
function legacyTurnMarkerPath(sid) {
  return join(LEGACY_BASE, sid, 'turn-marker.json');
}

// ── Tests ──

describe('backward-compat mirror: when legacy .claude-agent-monitor/state exists', () => {
  const sessions = [];
  let legacyBaseCreatedByTest = false;

  before(() => {
    // The mirror only fires when the legacy base directory exists.
    // If the user's machine doesn't have it, create it temporarily so the
    // tests can exercise the mirror branch. Track creation so we can remove
    // it on cleanup without nuking a pre-existing user directory.
    if (!existsSync(LEGACY_BASE)) {
      mkdirSync(LEGACY_BASE, { recursive: true });
      legacyBaseCreatedByTest = true;
    }
  });

  afterEach(() => {
    for (const sid of sessions) {
      try { cleanSessionState(sid); } catch { /* ignore */ }
      // Belt-and-braces: cleanSessionState already removes both, but if a test
      // failed mid-way the mirror dir may still be present.
      try { rmSync(join(LEGACY_BASE, sid), { recursive: true, force: true }); } catch { /* ignore */ }
      try { rmSync(join(CANONICAL_BASE, sid), { recursive: true, force: true }); } catch { /* ignore */ }
    }
    sessions.length = 0;
  });

  it('1. writeAgentState mirrors agent JSON to legacy directory', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);
    const aid = 'aabbccdd00011001';

    writeAgentState(makeAgent(sid, aid, { status: 'active' }));

    assert.ok(existsSync(canonicalAgentPath(sid, aid)), 'canonical agent file should exist');
    assert.ok(existsSync(legacyAgentPath(sid, aid)), 'legacy mirror agent file should exist');

    // The two files must contain identical bytes.
    const canonical = readFileSync(canonicalAgentPath(sid, aid), 'utf-8');
    const mirror = readFileSync(legacyAgentPath(sid, aid), 'utf-8');
    assert.equal(canonical, mirror, 'mirror should match canonical byte-for-byte');
  });

  it('2. advanceTurn mirrors turn-marker.json to legacy directory', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);

    advanceTurn(sid);

    assert.ok(existsSync(canonicalTurnMarkerPath(sid)), 'canonical turn-marker should exist');
    assert.ok(existsSync(legacyTurnMarkerPath(sid)), 'legacy mirror turn-marker should exist');

    const canonical = JSON.parse(readFileSync(canonicalTurnMarkerPath(sid), 'utf-8'));
    const mirror = JSON.parse(readFileSync(legacyTurnMarkerPath(sid), 'utf-8'));
    assert.equal(canonical.turnNumber, mirror.turnNumber, 'turn numbers should match');
  });

  it('3. cleanStoppedAgents removes mirror file too', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);
    const aid = 'aabbccdd00011002';

    advanceTurn(sid); // turn 1
    writeAgentState(makeAgent(sid, aid, {
      status: 'stopped',
      stoppedAt: new Date().toISOString(),
      turnNumber: 1,
    }));
    assert.ok(existsSync(legacyAgentPath(sid, aid)), 'mirror should exist before cleanup');

    advanceTurn(sid); // turn 2
    const removed = cleanStoppedAgents(sid);
    assert.equal(removed, 1);
    assert.ok(!existsSync(canonicalAgentPath(sid, aid)), 'canonical should be removed');
    assert.ok(!existsSync(legacyAgentPath(sid, aid)), 'mirror should be removed');
  });

  it('4. cleanAllAgents removes mirror files too', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);
    const a1 = 'aabbccdd00011003';
    const a2 = 'aabbccdd00011004';

    writeAgentState(makeAgent(sid, a1, { status: 'active' }));
    writeAgentState(makeAgent(sid, a2, { status: 'stopped', stoppedAt: new Date().toISOString() }));
    assert.ok(existsSync(legacyAgentPath(sid, a1)));
    assert.ok(existsSync(legacyAgentPath(sid, a2)));

    const removed = cleanAllAgents(sid);
    assert.equal(removed, 2);
    assert.ok(!existsSync(canonicalAgentPath(sid, a1)));
    assert.ok(!existsSync(canonicalAgentPath(sid, a2)));
    assert.ok(!existsSync(legacyAgentPath(sid, a1)));
    assert.ok(!existsSync(legacyAgentPath(sid, a2)));
  });

  it('5. cleanSessionState removes mirror session directory', () => {
    const sid = uniqueSessionId();
    sessions.push(sid);
    const aid = 'aabbccdd00011005';

    advanceTurn(sid);
    writeAgentState(makeAgent(sid, aid));
    assert.ok(existsSync(join(LEGACY_BASE, sid)), 'mirror session dir should exist');

    cleanSessionState(sid);
    assert.ok(!existsSync(join(CANONICAL_BASE, sid)), 'canonical session dir should be gone');
    assert.ok(!existsSync(join(LEGACY_BASE, sid)), 'mirror session dir should be gone');
  });

  after(() => {
    // Only remove LEGACY_BASE if we created it. A pre-existing user mirror is
    // preserved so we never delete real session data.
    if (legacyBaseCreatedByTest && existsSync(LEGACY_BASE)) {
      try { rmSync(LEGACY_BASE, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

describe('backward-compat mirror: when legacy directory is absent', () => {
  // Override homedir() by pointing USERPROFILE (Windows) and HOME (POSIX) at a
  // fresh tempdir for the duration of these tests. The tempdir contains no
  // .claude-agent-monitor directory, so getMirrorSessionDir() must return null
  // and writeAgentState / advanceTurn must not create any legacy mirror.

  let tempHome;
  let originalUserProfile;
  let originalHome;

  before(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'ccm-mirror-absent-'));
    originalUserProfile = process.env.USERPROFILE;
    originalHome = process.env.HOME;
    process.env.USERPROFILE = tempHome;
    process.env.HOME = tempHome;
    // Sanity check: os.homedir() must now resolve to the temp dir.
    assert.equal(homedir(), tempHome, 'homedir() should reflect the env override');
    assert.ok(!existsSync(join(tempHome, '.claude-agent-monitor', 'state')),
      'legacy base must not exist in the temp home');
  });

  after(() => {
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    try { rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('7. writeAgentState does NOT create legacy mirror when legacy base is absent', () => {
    const sid = uniqueSessionId();
    const aid = 'aabbccdd00011007';

    writeAgentState(makeAgent(sid, aid));

    // Canonical write went to the temp homedir.
    const canonical = join(tempHome, '.claude-cli-monitor', 'state', sid, `agent-${aid}.json`);
    assert.ok(existsSync(canonical), 'canonical file should exist in temp home');

    // The legacy base was never created — and certainly not the session sub-dir.
    const legacy = join(tempHome, '.claude-agent-monitor', 'state', sid, `agent-${aid}.json`);
    assert.ok(!existsSync(legacy), 'no legacy mirror should exist');
    assert.ok(!existsSync(join(tempHome, '.claude-agent-monitor')),
      'legacy base directory should not be created');
  });

  it('8. advanceTurn does NOT create legacy turn-marker when legacy base is absent', () => {
    const sid = uniqueSessionId();

    advanceTurn(sid);

    const canonical = join(tempHome, '.claude-cli-monitor', 'state', sid, 'turn-marker.json');
    assert.ok(existsSync(canonical), 'canonical turn-marker should exist');

    const legacy = join(tempHome, '.claude-agent-monitor', 'state', sid, 'turn-marker.json');
    assert.ok(!existsSync(legacy), 'no legacy turn-marker should exist');
    assert.ok(!existsSync(join(tempHome, '.claude-agent-monitor')),
      'legacy base directory should not be created');
  });
});
