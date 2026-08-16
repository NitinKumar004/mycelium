// Video export (§8): canvas.captureStream(60) -> MediaRecorder -> WebM/VP9.
export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(private canvas: HTMLCanvasElement) {}

  get active(): boolean {
    return this.rec?.state === 'recording';
  }

  start(): boolean {
    if (this.active) return true;
    const stream = this.canvas.captureStream(60);
    const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 24_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => this.save();
    this.rec.start(100);
    return true;
  }

  stop(): void {
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
  }

  private save(): void {
    const blob = new Blob(this.chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mycelium-${Date.now()}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.rec = null;
  }
}
