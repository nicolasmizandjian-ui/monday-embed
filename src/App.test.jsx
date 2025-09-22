import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const listeners = vi.hoisted(() => ({}));
const listenMock = vi.hoisted(() => vi.fn());
const mockMonday = vi.hoisted(() => ({
  get: vi.fn(),
  listen: listenMock,
  api: vi.fn(),
}));

vi.mock("monday-sdk-js", () => ({
  default: () => mockMonday,
}));

import App from "./App";

describe("App", () => {
  beforeEach(() => {
    Object.keys(listeners).forEach((event) => delete listeners[event]);

    mockMonday.get.mockReset();
    mockMonday.api.mockReset();
    listenMock.mockReset();
    listenMock.mockImplementation((event, callback) => {
      listeners[event] = callback;
      return () => {
        if (listeners[event] === callback) {
          delete listeners[event];
        }
      };
    });

    mockMonday.get.mockResolvedValue({ data: null });
    mockMonday.api.mockResolvedValue({
      data: { items_page_by_board: { items: [] } },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("affiche un message de chargement tant que le contexte est absent", () => {
    render(<App />);

    expect(
      screen.getByText(/Chargement du contexte…/i)
    ).toBeInTheDocument();
  });

  it("affiche les items du board courant quand l'API répond", async () => {
    mockMonday.get.mockResolvedValue({ data: { boardId: 42 } });
    mockMonday.api.mockResolvedValue({
      data: {
        items_page_by_board: {
          items: [
            { id: "1", name: "Premier item" },
            { id: "2", name: "Deuxième item" },
          ],
        },
      },
    });

    render(<App />);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 2, name: /items \(50 max\)/i })
      ).toBeInTheDocument()
    );

    expect(screen.getByText(/1 — Premier item/)).toBeInTheDocument();
    expect(screen.getByText(/2 — Deuxième item/)).toBeInTheDocument();
  });

  it("écoute les changements de contexte et recharge les items", async () => {
    expect(listenMock).not.toHaveBeenCalled();

    mockMonday.get.mockResolvedValue({ data: { boardId: 42 } });
    mockMonday.api.mockImplementation((_, { variables }) => {
      if (variables.boardId === "84") {
        return Promise.resolve({
          data: {
            items_page_by_board: {
              items: [{ id: "3", name: "Nouveau board" }],
            },
          },
        });
      }

      return Promise.resolve({
        data: {
          items_page_by_board: {
            items: [{ id: "1", name: "Board initial" }],
          },
        },
      });
    });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText(/Board initial/)).toBeInTheDocument()
    );

    expect(listenMock).toHaveBeenCalledWith("context", expect.any(Function));

    act(() => {
      listeners.context?.({ data: { boardId: 84 } });
    });

    await waitFor(() =>
      expect(screen.getByText(/Nouveau board/)).toBeInTheDocument()
    );

    expect(mockMonday.api).toHaveBeenCalledWith(
      expect.stringContaining("items_page_by_board"),
      expect.objectContaining({
        variables: expect.objectContaining({ boardId: "84" }),
      })
    );
  });
});