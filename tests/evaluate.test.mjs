import { test } from 'node:test';
import assert from 'node:assert/strict';

test('atribuirLibreria elige la actividad más citada, no la más larga', async () => {
  const { atribuirLibreria } = await import('../scripts/evaluate.mjs');
  const cat = { ValidarEPS: { '1.0.147': { activities: ['LoginFamisanar', 'LoginSaludTotal'] } } };
  const txt = 'Login Famisanar no se completó at Sequence "LoginFamisanar" | at Sequence "LoginSaludTotal" | at "LoginFamisanar"';
  const r = atribuirLibreria(txt, [{ name: 'ValidarEPS', version: '1.0.147' }], cat);
  assert.equal(r.activity, 'LoginFamisanar');
});
