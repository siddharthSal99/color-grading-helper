import type { Background } from './render';
import { renderFrame } from './render';

export type VideoJob = {
  file: File;
  outW: number;
  outH: number;
  bg: Background;
  marginPct: number;
  onProgress: (p: number) => void;
};

export type VideoJobHandle = { promise: Promise<Blob>; cancel: () => void };

/**
 * Re-encode a video into the padded canvas using WebCodecs (via mediabunny), entirely in the browser.
 * Output is MP4 (H.264 when the browser can encode it), audio is copied or re-encoded as needed.
 */
export function padVideo(job: VideoJob): VideoJobHandle {
  let cancel = () => {};
  const promise = (async () => {
    const mb = await import('mediabunny');
    const input = new mb.Input({ source: new mb.BlobSource(job.file), formats: mb.ALL_FORMATS });
    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new mb.BufferTarget(),
    });
    const codec = await mb.getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], {
      width: job.outW,
      height: job.outH,
    });
    if (!codec) throw new Error('This browser cannot encode video. Try a recent Chrome, Edge or Safari.');

    const canvas = new OffscreenCanvas(job.outW, job.outH);
    const ctx = canvas.getContext('2d')!;

    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: {
        codec,
        quality: mb.QUALITY_HIGH,
        forceTranscode: true,
        processedWidth: job.outW,
        processedHeight: job.outH,
        process: (sample) => {
          renderFrame(
            ctx,
            job.outW,
            job.outH,
            sample.displayWidth,
            sample.displayHeight,
            (c, x, y, w, h) => sample.draw(c, x, y, w, h),
            job.bg,
            job.marginPct,
          );
          return canvas;
        },
      },
      showWarnings: false,
    });
    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((t) => t.reason).join(', ');
      throw new Error(`This video can't be converted in this browser (${reasons || 'unsupported format'}).`);
    }
    cancel = () => void conversion.cancel();
    conversion.onProgress = (p) => job.onProgress(p);
    await conversion.execute();
    const buf = (output.target as InstanceType<typeof mb.BufferTarget>).buffer!;
    return new Blob([buf], { type: 'video/mp4' });
  })();
  return { promise, cancel: () => cancel() };
}
