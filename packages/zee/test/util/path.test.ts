import { describe, expect, test } from "bun:test";
import { getFilename, getDirectory, getFileExtension } from "../../src/util/path";

describe("path utils", () => {
  describe("getFilename", () => {
    test("extracts filename from path", () => {
      expect(getFilename("path/to/file.txt")).toBe("file.txt");
      expect(getFilename("file.txt")).toBe("file.txt");
      expect(getFilename("/file.txt")).toBe("file.txt");
      expect(getFilename("path\\to\\file.txt")).toBe("file.txt");
    });

    test("handles trailing slashes", () => {
      expect(getFilename("dir/")).toBe("dir");
      expect(getFilename("dir//")).toBe("dir");
    });

    test("handles undefined", () => {
      expect(getFilename(undefined)).toBe("");
    });
  });

  describe("getDirectory", () => {
    test("extracts directory from path", () => {
      expect(getDirectory("path/to/file.txt")).toBe("path/to/");
      expect(getDirectory("file.txt")).toBe("/");
    });

    test("normalizes separators to forward slashes", () => {
      expect(getDirectory("path\\to\\file.txt")).toBe("path/to/");
    });

    test("handles undefined", () => {
      expect(getDirectory(undefined)).toBe("");
    });
  });

  describe("getFileExtension", () => {
    test("extracts extension", () => {
      expect(getFileExtension("file.txt")).toBe("txt");
      expect(getFileExtension("path/to/file.json")).toBe("json");
    });

    test("returns full string if no extension", () => {
      expect(getFileExtension("makefile")).toBe("makefile");
    });

    test("handles empty extension", () => {
      expect(getFileExtension("file.")).toBe("");
    });

    test("handles undefined", () => {
      expect(getFileExtension(undefined)).toBe("");
    });
  });
});
