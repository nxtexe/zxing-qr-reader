import React from 'react';
import QrReader, {IResult} from 'zxing-qr-reader';
import Chip from './Chip';
import './App.css';
import ProfileDisplay from './ProfileDisplay';
import { IPosition } from 'zxing-qr-reader/zxing';

interface AppState {
  file?: File;
  mspf: string;
  fps: string;
  result?: URL | string;
  position?: IPosition;
}

class App extends React.Component<any, AppState> {
  private qr_reader: QrReader | null = null;
  private _context: CanvasRenderingContext2D | null = null;
  private foundTimeoutID: number = 0;
  state: AppState = {
    fps: '',
    mspf: '',
  }

  componentDidMount() {
    const canvas: HTMLCanvasElement = document.getElementById('stream-buffer') as HTMLCanvasElement;
    this._context = canvas.getContext('2d');

    if (this._context) {
      this.qr_reader = new QrReader(this._context);
      this.qr_reader.on('error', (e: Error) => alert(e));
      this.qr_reader.on('found', this.onFound);
      this.qr_reader.on('scan', (result: IResult) => {
        if (process.env.NODE_ENV !== 'development') return;
        const {fps, mspf} = result.profile_info;
        this.setState({fps, mspf});
      });
      this.qr_reader.on('render', (context: CanvasRenderingContext2D) => {
        if (this.state.position === undefined) return;

        context.fillStyle = "yellow";
        for (let value of Object.values(this.state.position)) {
          const {x, y} = value;
          context.fillRect(x, y, 10, 10);
        }
      });

      this.qr_reader.scan();
    }
  }

  async componentWillUnmount() {
    if (this.qr_reader) {
      await this.qr_reader.stop();
    }
  }

  onFound = async (result: IResult) => {
    if (!this.qr_reader) return;

    try {
      this.setState({result: new URL(result.text)});
    } catch (e) {
      this.setState({result: result.text});
    }
    this.setState({position: result.position});

    window.clearTimeout(this.foundTimeoutID);
    
    

    this.foundTimeoutID = window.setTimeout(() => {
      this.setState({position: undefined, result: undefined});
    }, 100);
  }

  render() {
    const height: number = window.screen.width < 500 && window.screen.height > window.screen.width ? 852 : 480;
    return (
      <div className="App">
        <Chip content={this.state.result} />
        <ProfileDisplay fps={this.state.fps || '0'} mspf={this.state.mspf || '0'} />
        <header className="App-header">
          <div id="canvas-container">
            <canvas width={480} height={height} id="stream-buffer" />
          </div>
        </header>
      </div>
    );
  }
}

export default App;
