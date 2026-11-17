// Start one model instance with its fixed MODEL_ID, port and isolated on-disk database directory.
import { spawn } from 'node:child_process';
import path from 'node:path';
const [model = '4', mode = 'dev'] = process.argv.slice(2);
const supported = { 4: 3104 };
if (!supported[model]) { console.error(`Model ${model} is not built in this workspace yet (implemented: model 4).`); process.exit(1); }
const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env, MODEL_ID: model, APP_ENV: process.env.APP_ENV || 'prototype', PAYSTAR_ROOT: root,
  DATA_DIR: process.env.DATA_DIR || path.join(root, '.data.nosync', `model${model}`), PORT: String(supported[model]), NEXT_TELEMETRY_DISABLED: '1' };
const args = mode === 'start' ? ['start', '-p', env.PORT] : ['dev', '-p', env.PORT];
console.log(`PayStar model ${model} → http://localhost:${env.PORT}  (data: ${env.DATA_DIR})`);
const child = spawn(path.join(root, 'node_modules', '.bin', 'next'), args, { env, stdio: 'inherit', cwd: root });
child.on('exit', (c) => process.exit(c ?? 0));
