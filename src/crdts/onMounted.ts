import { IState, LWWRegister } from "./llw-register";
import { MessageSocket } from "./socket";

export function onMounted() {
  (() => {
    const clientId = "bob";
    const shareDate = new LWWRegister<string>(clientId, {
      peer: clientId,
      timestamp: Date.now(),
      value: "hello",
    });
    const ms = new MessageSocket<IState<string>>(clientId);

    const inputEl = document.querySelector(`#${clientId}`) as HTMLInputElement;

    ms.on("data", (state) => {
      shareDate.merge(state);
      inputEl.value = shareDate.value;
    });

    // 绑定到Dom上
    inputEl.addEventListener("change", (e) => {
      shareDate.value = inputEl.value;
      ms.send(shareDate.state);
    });
  })();

  (() => {
    const clientId = "alice";
    const shareDate = new LWWRegister<string>(clientId, {
      peer: clientId,
      timestamp: Date.now(),
      value: "hello",
    });
    const ms = new MessageSocket<IState<string>>(clientId);

    const inputEl = document.querySelector(`#${clientId}`) as HTMLInputElement;

    ms.on("data", (state) => {
      shareDate.merge(state);
      inputEl.value = shareDate.value;
    });

    // 绑定到Dom上
    inputEl.addEventListener("change", (e) => {
      shareDate.value = inputEl.value;
      ms.send(shareDate.state);
    });
  })();
}
