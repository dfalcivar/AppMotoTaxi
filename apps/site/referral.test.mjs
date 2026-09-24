import {test} from 'node:test';
import assert from 'node:assert/strict';
import {referralLocation,appleStoreLink} from './src/r/referral-model.mjs';
test('neutral link preserves personal code and programme for installed apps',()=>{
 assert.deepEqual(referralLocation(new URL('https://costa-go.com/r/CG-0123456789abcdef?p=INVITE')),{code:'CG-0123456789ABCDEF',program:'INVITE',deepLink:'costa-go://referral/CG-0123456789ABCDEF?p=INVITE'});
});
test('invalid code or programme cannot become a deep link',()=>{
 for(const url of ['https://costa-go.com/r/nope?p=INVITE','https://costa-go.com/r/CG-0123456789ABCDEF?p=%3Cscript%3E'])assert.equal(referralLocation(new URL(url)),null);
});
test('future Apple Store URL is optional and restricted to the real store',()=>{
 assert.equal(appleStoreLink(null),null);assert.equal(appleStoreLink('javascript:alert(1)'),null);assert.equal(appleStoreLink('https://apps.apple.com.evil.test/app'),null);assert.equal(appleStoreLink('https://apps.apple.com/app/id123'),'https://apps.apple.com/app/id123');
});

test('bare code links work without a programme hint',()=>{assert.deepEqual(referralLocation(new URL('https://costa-go.com/r/CG-0123456789ABCDEF')),{code:'CG-0123456789ABCDEF',program:'',deepLink:'costa-go://referral/CG-0123456789ABCDEF'});});
