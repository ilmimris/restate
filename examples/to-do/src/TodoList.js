import React from "react";
import { AppAction, AppInterfaces } from './App.Data';

import "./TodoList.css";

import { Todo } from "./Todo";
import { TodoForm } from "./TodoForm";

const TodoList = React.memo(({ todos }) => {

  return (
    <>
      <div className="todo-container">
        <div className="todo-list">
          {todos.map((todo, index) => (
            <Todo
              index={index}
              todo={todo}
            />
          ))}
          <TodoForm />
        </div>
      </div>
    </>
  );
})

export default AppInterfaces.todoInfo(TodoList);
