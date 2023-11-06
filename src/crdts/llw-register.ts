// 最后写入者胜出寄存器
import { Observable } from "lib0/observable";
import { MessageSocket } from "./socket";

export interface IState<T> {
  peer: string;
  timestamp: number;
  value: T;
}

export class LWWRegister<T> {
  readonly id: string;

  state: IState<T>;

  constructor(id: string, state: IState<T>) {
    this.id = id;
    this.state = state;
  }

  get value() {
    return this.state.value;
  }

  set(value: T) {
    this.state = {
      peer: this.id,
      timestamp: this.state.timestamp + 1,
      value,
    };
  }

  merge(state: IState<T>) {
    const { peer: remotePeer, timestamp: remoteTimestamp } = state;

    const { peer: localPeer, timestamp: localTimestamp } = this.state;

    if (localTimestamp > remoteTimestamp) {
      return;
    }

    if (localTimestamp === remoteTimestamp && remotePeer !== localPeer) {
      return;
    }

    this.state = state;
  }
}
