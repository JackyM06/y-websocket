import { Observable } from "lib0/observable";

export class MessageSocket<T> extends Observable<"data"> {
  bc: BroadcastChannel;

  constructor(private id: string, room = "llw") {
    super();

    this.bc = new BroadcastChannel(room);

    this.bc.addEventListener("message", ({ data }) => {
      const { id, payload } = data;
      if (id === this.id) {
        return;
      }
      this.emit("data", [payload]);
    });
  }

  send(payload: T) {
    this.bc.postMessage({
      id: this.id,
      payload,
    });
  }
}
