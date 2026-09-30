export function createLoginBackground(video, image, defaultVideo) {
  let source = '';
  let visible = false;
  let isVideo = true;
  video.muted = true;
  video.defaultMuted = true;

  function play() {
    if (!visible || !isVideo) return;
    // Keep the poster visible if browser settings prevent autoplay.
    void video.play().catch(() => {});
  }

  function setSource(value = '') {
    const next = new URL(value || defaultVideo, defaultVideo).href;
    if (next === source) return;
    source = next;
    isVideo = /\.(?:mp4|webm|ogg)$/iu.test(new URL(next).pathname);
    image.hidden = isVideo;
    video.hidden = !isVideo;
    if (isVideo) {
      if (video.src !== next) video.src = next;
      video.onerror = () => { if (source !== defaultVideo) setSource(); };
      play();
    } else {
      video.pause();
      image.onerror = () => setSource();
      image.src = next;
    }
  }

  function setVisible(value) {
    visible = value;
    if (visible) play();
    else video.pause();
  }

  return { setSource, setVisible, play };
}
