const AUDIO_WORKLET_SOURCE = `
class TBProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buf = new Float32Array(22000);
        this.r = 0; this.w = 0; this.size = 0;
        this.port.onmessage = ({ data }) => {
            const a = new Float32Array(data);
            for (let i = 0; i < a.length; i++) {
                if (this.size < this.buf.length) {
                    this.buf[this.w] = a[i];
                    this.w = (this.w + 1) % this.buf.length;
                    this.size++;
                }
            }
        };
    }
    process(_inputs, outputs) {
        const out = outputs[0][0];
        for (let i = 0; i < out.length; i++) {
            if (this.size > 0) {
                out[i] = this.buf[this.r];
                this.r = (this.r + 1) % this.buf.length;
                this.size--;
            } else {
                out[i] = 0;
            }
        }
        return true;
    }
}
registerProcessor('tinybit', TBProcessor);
`;

export async function attachAudioWorklet(ctx: AudioContext): Promise<AudioWorkletNode> {
    const blob = new Blob([AUDIO_WORKLET_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
        await ctx.audioWorklet.addModule(url);
    } finally {
        URL.revokeObjectURL(url);
    }
    return new AudioWorkletNode(ctx, 'tinybit', { numberOfOutputs: 1, outputChannelCount: [1] });
}
