import React, { useRef } from "react";
import { AppAction } from "./App.Data";

export function Todo({ todo, index}) {
  const appAction = useRef(null);
  return (
    <>
    <AppAction ref={appAction}/>
    <div
      className="todo"
      style={{ textDecoration: todo.isCompleted ? "line-through" : "" }}
    >
      {todo.text}

      <div>
        <button onClick={() => appAction.current.completeTodo(index)}>Complete</button>
        <button onClick={() => appAction.current.removeTodo(index)}>x</button>
      </div>
    </div>
    </>
  );
}
