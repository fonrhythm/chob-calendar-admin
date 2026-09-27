import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isRecoveryReturn} from '../src/lib/recovery.js';
test('password recovery is detected at site root and error returns, without treating normal sign-in as recovery',()=>{
assert.equal(isRecoveryReturn('https://example.com/admin/#type=recovery&access_token=fake'),true);
assert.equal(isRecoveryReturn('https://example.com/admin/update-password'),true);
assert.equal(isRecoveryReturn('https://example.com/admin/#error=access_denied&error_code=otp_expired'),true);
assert.equal(isRecoveryReturn('https://example.com/admin/#type=signup'),false);
assert.equal(isRecoveryReturn('https://example.com/admin/login'),false);
});
