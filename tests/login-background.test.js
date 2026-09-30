import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoginBackground } from '../public/login-background.js';

const defaultVideo = 'https://pit-stop.example/assets/login-tuner-native.webm';
function setup(reject = false) {
  const calls = { play: 0, pause: 0, sources: 0 };
  let source = defaultVideo;
  const video = {
    hidden: false,
    get src() { return source; },
    set src(value) { source = value; calls.sources++; },
    play() { calls.play++; return reject ? Promise.reject(new Error('Autoplay blocked')) : Promise.resolve(); },
    pause() { calls.pause++; },
  };
  const image = { hidden: true };
  return { controller: createLoginBackground(video, image, defaultVideo), video, image, calls };
}

test('login playback starts muted when shown and repeated appearance updates do not restart it', () => {
  const { controller, video, calls } = setup();
  controller.setSource();
  assert.equal(video.muted, true);
  assert.equal(video.defaultMuted, true);
  assert.equal(calls.play, 0);
  controller.setVisible(true);
  controller.setSource();
  controller.setSource(null);
  assert.equal(calls.play, 1);
  assert.equal(calls.sources, 0);
  controller.setVisible(false);
  controller.play();
  assert.equal(calls.pause, 1);
  assert.equal(calls.play, 1);
});

test('blocked autoplay retains the poster and permits a later gesture retry', async () => {
  const { controller, video, calls } = setup(true);
  controller.setSource();
  controller.setVisible(true);
  await Promise.resolve();
  assert.equal(video.hidden, false);
  controller.play();
  await Promise.resolve();
  assert.equal(calls.play, 2);
});

test('custom backgrounds pause video and broken custom media falls back to the supplied video', () => {
  const { controller, video, image, calls } = setup();
  controller.setSource();
  controller.setVisible(true);
  controller.setSource('https://example.com/garage.jpg');
  assert.equal(video.hidden, true);
  assert.equal(image.hidden, false);
  assert.equal(calls.pause, 1);
  image.onerror();
  assert.equal(video.hidden, false);
  assert.equal(image.hidden, true);
  controller.setSource('https://example.com/garage.mp4');
  video.onerror();
  assert.equal(video.src, defaultVideo);
});
