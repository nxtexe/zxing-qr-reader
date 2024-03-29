import {IResult} from './zxing';
export type {IResult};

export interface ICallbacks {
    found?: (result: IResult) => void | Function;
    scan?: Function;
    error?: (error: string | Error) => void | Function;
    render?: (context: CanvasRenderingContext2D) => void | Function;
}
enum Eevents {
    found,
    scan,
    error,
    render
}
export type events = keyof typeof Eevents;

export default class QrReader {
    private _output_render_context: CanvasRenderingContext2D;
    private _video: HTMLVideoElement;
    private _stream: MediaStream = new MediaStream();
    private _is_scanning: boolean = false;
    private _anim_id: number = 0;
    private _interval_id: number = 0;
    private _worker: Worker;
    private _callbacks: ICallbacks = {};

    constructor(context: CanvasRenderingContext2D) {
        this._output_render_context = context;
        this._video = document.createElement('video') as HTMLVideoElement;
        this._video.playsInline = true;
        this._video.muted = true;
        this._video.autoplay = true;

        //clear canvas to black
        this._output_render_context.fillStyle = "black";
        const {width, height} = this._output_render_context.canvas;
        this._output_render_context.fillRect(0, 0, width, height);

        this._worker = new Worker(new URL('./reader.worker.ts', import.meta.url), {
            name: "reader.worker",
            type: "module"
        });

        this._worker.onmessage = (event: MessageEvent<IResult>) => {
            if (event.data.error && this._callbacks.error) {
                this._callbacks.error(event.data.error);
                return;
            }
            if (this._callbacks.scan) this._callbacks.scan(event.data);
            if (this._callbacks.found && event.data.text.length) this._callbacks.found(event.data);
        }
}

    private async _read() {
        const {width, height} = this._output_render_context.canvas;
        const image_buffer = this._output_render_context.getImageData(0, 0, width, height).data.buffer;
        this._worker.postMessage({image_buffer, width, height}, [image_buffer]);

        if (this._is_scanning) {
            this._interval_id = requestAnimationFrame(this._read.bind(this));
        } else {
            cancelAnimationFrame(this._interval_id);
        }
    }

    private async _render() {
        //scale to cover
        let originalRatios = {
            width: this._output_render_context.canvas.width / this._video.videoWidth,
            height: this._output_render_context.canvas.height / this._video.videoHeight
        };
        
        // formula for cover:
        let coverRatio = Math.max(originalRatios.width, originalRatios.height); 
        
        // result:
        let newImageWidth = this._video.videoWidth * coverRatio;
        let newImageHeight = this._video.videoHeight * coverRatio;

        // // get the top left position of the image
        let x = (this._output_render_context.canvas.width / 2) - (this._video.videoWidth / 2) * coverRatio;
        let y = (this._output_render_context.canvas.height / 2) - (this._video.videoHeight / 2) * coverRatio;


        this._output_render_context.drawImage(this._video, x, y, newImageWidth, newImageHeight);

        if (this._callbacks.render) this._callbacks.render(this._output_render_context);
        

        if (this._is_scanning) {
            this._anim_id = window.requestAnimationFrame(this._render.bind(this));
        } else {
            window.cancelAnimationFrame(this._anim_id);
        }
        
    }

    public print(text: string, x: number, y: number, lineHeight: number) {
        const maxWidth: number = this._output_render_context.canvas.getBoundingClientRect().width;
        let words: string[] = text.split(' ');
        let line: string = '';

        //write error message to canvas
        this._output_render_context.font = "20px Arial";
        this._output_render_context.fillStyle = "white";
        this._output_render_context.textAlign = "center";

        for(let n = 0; n < words.length; n++) {
          let testLine: string = line + words[n] + ' ';
          let metrics: TextMetrics = this._output_render_context.measureText(testLine);
          let testWidth: number = metrics.width;
          if (testWidth > maxWidth && n > 0) {
            this._output_render_context.fillText(line, x, y);
            line = words[n] + ' ';
            y += lineHeight;
          }
          else {
            line = testLine;
          }
        }
        this._output_render_context.fillText(line, x, y);
    }

    public scan(): Promise<void> {
        const aspectRatio = this._output_render_context.canvas.width / this._output_render_context.canvas.height;
        return new Promise(async (resolve, reject) => {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                try {
                    if (!this._is_scanning) {
                        this._stream = await navigator.mediaDevices.getUserMedia({
                            video: {
                                width: {
                                    max: this._output_render_context.canvas.width
                                }, 
                                height: {
                                    max: this._output_render_context.canvas.height
                                },
                                facingMode: 'environment',
                                frameRate: {
                                    min: 24,
                                    max: 60
                                },
                                aspectRatio: {max: aspectRatio}
                            }
                        });

                        const [track] = this._stream.getVideoTracks();
                        if ('getCapabilities' in track) {
                            const capabilities = track.getCapabilities();
                            const width = Math.min(this._output_render_context.canvas.width, capabilities.width?.max || 0);
                            const height = Math.min(this._output_render_context.canvas.height, capabilities.height?.max || 0);
                            const frameRate = Math.min(60, capabilities.frameRate?.max || 0);
                            const constraints: MediaTrackConstraints = {
                                width: {max: width || this._output_render_context.canvas.width}, 
                                height: {max: height || this._output_render_context.canvas.height},
                                facingMode: 'environment',
                                frameRate: {
                                    min: 24,
                                    max: frameRate || 60
                                },
                                aspectRatio: aspectRatio
                            };
                            await track.applyConstraints(constraints);
                        }
                      
                        this._video.srcObject = this._stream;
                        this._video.onloadedmetadata = () => {
                            this._video.play();
                            this._is_scanning = true;

                            this._render();
                            this._interval_id = requestAnimationFrame(this._read.bind(this));

                            resolve();
                        }
                        
                        
    
                    } else {
                        const error: Error = new Error("Stream already initialised.");
                        if (this._callbacks.error) {
                            this._callbacks.error(error);
                        }

                        reject(error);
                    }
                } catch(e) {
                    if (this._callbacks.error) {
                        this._callbacks.error(e as Error);
                    }

                    
                    this.print("Error. Permission denied. Please update browser permissions to access camera.", this._output_render_context.canvas.width / 2, this._output_render_context.canvas.height / 2, 25);

                    reject(e);
                }
            
            } else {
                const error: Error = new Error("Browser does not support getUserMedia.");
                if (this._callbacks.error) {
                    this._callbacks.error(error);
                }

                //write error message to canvas
                this.print("Error. Your browser does not support camera access. Use a modern browser or update your browser.", this._output_render_context.canvas.width / 2, this._output_render_context.canvas.height / 2, 25);

                reject(error);
            }
        })
    }

    public stop(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this._worker.terminate();
            if (this._stream) {
                //stop scanning
                this._is_scanning = false;
                //stop camera
                this._video.pause();
                this._video.src = "";
                this._stream.getTracks().forEach(function(track) {
                    track.stop();
                });
    
                //clear canvas to black
                this._output_render_context.fillStyle = "black";
                this._output_render_context.fillRect(0, 0, this._output_render_context.canvas.width, this._output_render_context.canvas.height);
                resolve(true);
            } else {
                reject(new Error("Stream was not initialised."));
            }
        })
    }

    public on(event: events, callback: Function): void {
        switch(event) {
            case "found":
                this._callbacks.found = callback as (result: IResult) => void;
                break;
            
            case "scan":
                this._callbacks.scan = callback;
                break;
            
            case "error":
                this._callbacks.error = callback as (error: string | Error) => void;
                break;
            
            case "render":
                this._callbacks.render = callback as (context: CanvasRenderingContext2D) => void;
                break;
        }
    }
}