#!/usr/bin/env node
/**
 * Print everything that determines how desktop locate coordinates are mapped.
 *
 * Locate errors on the `computer` target usually come from a disagreement
 * between the size the device reports and the screenshot it actually produces,
 * not from the model. A proportional error — near zero at the left edge and
 * growing to the right — is the signature of a scale mismatch, and this script
 * shows the numbers that produce it.
 *
 *   node scripts/diagnose-display.mjs
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPUTER_DIST = path.join(
  __dirname,
  '../packages/computer/dist/es/index.mjs',
);
const IMG_DIST = path.join(
  __dirname,
  '../packages/shared/dist/es/img/index.mjs',
);

const line = (label, value) => console.log(`${label.padEnd(24)} ${value}`);

async function main() {
  let ComputerDevice;
  let imageInfoOfBase64;
  try {
    ({ ComputerDevice } = await import(COMPUTER_DIST));
    ({ imageInfoOfBase64 } = await import(IMG_DIST));
  } catch (error) {
    console.error(
      'Could not load the built packages. Run `npx nx build @midscene/computer` first.',
    );
    console.error(String(error?.message ?? error));
    process.exitCode = 1;
    return;
  }

  const device = new ComputerDevice();
  await device.connect();

  try {
    // listDisplays is a static on the class, not an instance method.
    const displays =
      typeof ComputerDevice.listDisplays === 'function'
        ? await ComputerDevice.listDisplays().catch(() => undefined)
        : undefined;

    console.log('\n--- displays ---');
    if (Array.isArray(displays) && displays.length) {
      line('display count', String(displays.length));
      for (const d of displays) {
        console.log(`  ${JSON.stringify(d)}`);
      }
      if (displays.length > 1) {
        console.log(
          '\n  More than one display is attached. This is the most common source of\n' +
            '  proportional locate errors: size() and the captured display can describe\n' +
            '  different screens. Try again with a single display to confirm.',
        );
      }
    } else {
      line('display count', 'not reported by this platform');
    }

    const size = await device.size();
    const shot = await device.screenshotBase64();
    const info = await imageInfoOfBase64(shot);

    const dprX = info.width / size.width;
    const dprY = info.height / size.height;
    const aspectLogical = size.width / size.height;
    const aspectShot = info.width / info.height;

    console.log('\n--- geometry ---');
    line('device.size()', `${size.width} x ${size.height}`);
    line('screenshot', `${info.width} x ${info.height}`);
    line('dpr x / y', `${dprX.toFixed(4)} / ${dprY.toFixed(4)}`);
    line('aspect logical', aspectLogical.toFixed(5));
    line('aspect screenshot', aspectShot.toFixed(5));

    console.log('\n--- verdict ---');
    const problems = [];

    if (Math.abs(dprX - dprY) > 0.001) {
      problems.push(
        `dpr differs between axes (${dprX.toFixed(4)} vs ${dprY.toFixed(4)}).\n  Locate will be skewed along one axis only.`,
      );
    }
    if (Math.abs(aspectLogical - aspectShot) > 0.001) {
      problems.push(
        'Logical size and screenshot have different aspect ratios.\n' +
          '  The screenshot is not of the display that size() describes.',
      );
    }
    if (Math.abs(dprX - Math.round(dprX)) > 0.01) {
      problems.push(
        `dpr is not close to a whole number (${dprX.toFixed(4)}).\n  Expect proportional locate error growing toward the right edge.`,
      );
    }

    if (problems.length) {
      for (const p of problems) console.log(`PROBLEM: ${p}`);
      console.log(
        '\nInclude this output when reporting a locate accuracy issue.',
      );
      process.exitCode = 1;
    } else {
      console.log(
        'Geometry is self-consistent. A locate error on this machine is not\n' +
          'caused by display scaling; capture the raw model output next:\n' +
          '  DEBUG=midscene:ai:* npx midscene ./suite.yaml 2>&1 | grep -iE "bbox|rect"',
      );
    }
  } finally {
    await device.destroy?.();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
