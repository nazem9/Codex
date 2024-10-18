import "./styles.scss";
import { Container, Paper } from "@mantine/core";
import { Page } from "common/Save";
import { useContext, useEffect, useMemo, useState, useCallback } from "react";
import { AppContext } from "types/AppStore";
import { Editor, EditorContent, useEditor } from "@tiptap/react";
import Toolbar from "./Toolbar/Toolbar";
import { extensions } from "./EditorExtensions";
import { TableOfContents } from "./TableOfContents";
import { EditorStyles } from "./EditorStyles";
import * as math from "mathjs";
import katex from "katex";
import "katex/dist/katex.min.css";

type Props = {
  page: Page;
  setEditorRef: (e: Editor | null) => void;
};

// Helper function to convert column index to letter
function columnIndexToLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

// Function to parse tables and assign cell references
function parseTables(content: string): { content: string; tableData: any } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/html");
  const tables = doc.querySelectorAll("table");

  const tableData: { [key: string]: { [key: string]: string } } = {};

  tables.forEach((table, tableIndex) => {
    const tableName = `table${tableIndex + 1}`;
    tableData[tableName] = {};

    const rows = table.querySelectorAll("tr");
    rows.forEach((row, rowIndex) => {
      const cells = row.querySelectorAll("td, th");
      cells.forEach((cell, cellIndex) => {
        const cellRef = `${columnIndexToLetter(cellIndex)}${rowIndex + 1}`;
        tableData[tableName][cellRef] = cell.textContent?.trim() || "";
      });
    });
  });

  return { content, tableData };
}

// Caching expressions to avoid recalculation
const expressionCache = new Map<string, string>();

function evaluateTableExpressions(content: string, tableData: any): string {
  return content.replace(/\{([^}]+)\}/g, (match, expression) => {
    if (expressionCache.has(expression)) {
      return expressionCache.get(expression)!;
    }

    try {
      // Handle LaTeX expressions with the `$$` delimiter
      if (expression.startsWith("$$") && expression.endsWith("$$")) {
        const latexExpression = expression.slice(2, -2).trim();
        const result = katex.renderToString(latexExpression, { throwOnError: false });
        expressionCache.set(expression, result);
        return result;
      }

      // Handle table-specific expressions
      if (expression.includes("table")) {
        const processedExpression = processTableExpression(expression, tableData);
        const result = math.evaluate(processedExpression, { ...math, getRange: (tableName: string, startCell: string, endCell: string) => getRange(tableName, startCell, endCell, tableData) });
        const roundedResult = typeof result === 'number' ? math.round(result, 3).toString() : result.toString();
        expressionCache.set(expression, roundedResult);
        return roundedResult;
      } else {
        // Handle regular math expressions
        const result = math.round(math.evaluate(expression), 3).toString();
        expressionCache.set(expression, result);
        return result;
      }
    } catch (error) {
      console.error(`Error evaluating expression: ${expression}`, error);
      return `<span style="color: red;">${expression}</span>`;
    }
  });
}

// Function to process table-related expressions
function processTableExpression(expression: string, tableData: any) {
  return expression.replace(/table\d+\[[A-Z]\d+:[A-Z]\d+\]/g, (match) => {
    const [tableName, range] = match.split('[');
    const [startCell, endCell] = range.slice(0, -1).split(':');
    return `getRange("${tableName}", "${startCell}", "${endCell}")`;
  });
}

// Function to extract values from a table range
function getRange(tableName: string, startCell: string, endCell: string, tableData: any): number[] {
  const table = tableData[tableName];
  if (!table) {
    throw new Error(`Table "${tableName}" not found.`);
  }

  const startCol = startCell.charCodeAt(0) - 65;
  const endCol = endCell.charCodeAt(0) - 65;
  const startRow = parseInt(startCell.slice(1)) - 1;
  const endRow = parseInt(endCell.slice(1)) - 1;

  const values: number[] = [];

  for (let col = startCol; col <= endCol; col++) {
    for (let row = startRow; row <= endRow; row++) {
      const cellRef = `${String.fromCharCode(col + 65)}${row + 1}`;
      const cellValue = table[cellRef];
      if (cellValue !== undefined && !isNaN(Number(cellValue))) {
        values.push(Number(cellValue));
      }
    }
  }

  return values;
}

// Utility function to debounce updates
function debounce(fn: Function, delay: number) {
  let timer: NodeJS.Timeout;
  return function (...args: any[]) {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Main component
export function EditorView({ page, setEditorRef }: Props) {
  const appContext = useContext(AppContext);
  const [previousContent, setPreviousContent] = useState<string>("");

  const _extensions = useMemo(
    () =>
      extensions({
        useTypography: appContext.prefs.editor.useTypographyExtension,
        tabSize: appContext.prefs.editor.tabSize,
      }),
    [appContext.prefs.editor.tabSize, appContext.prefs.editor.useTypographyExtension]
  );

  const content = useMemo(() => JSON.parse(window.api.loadPage(page.fileName)), [page.fileName]);

  const editor = useEditor({
    extensions: _extensions,
    autofocus: true,
    content: content,
    onUpdate: () => appContext.setUnsavedChanges(true),
  });

  // Optimized content update handler
  useEffect(() => {
    if (editor) {
      const updateContent = debounce(() => {
        const selection = editor.state.selection;
        const start = selection.from;
        const end = selection.to;

        const str = editor.getHTML();

        // Only evaluate if there is a closing brace
        if (str.includes("}")) {
          if (str !== previousContent) {
            const parsedTableData = parseTables(str); // Parse tables only once
            const newContent = evaluateTableExpressions(parsedTableData.content, parsedTableData.tableData);

            if (newContent !== previousContent) {
              editor.commands.setContent(newContent, false, { preserveWhitespace: true });
              setPreviousContent(newContent);
            }

            // Restore cursor position
            editor.commands.setTextSelection({ from: start, to: end });
          }
        }
      }, 300); // Debounced by 300ms to avoid frequent updates

      editor.on("update", updateContent);
    }
  }, [editor, previousContent]);

  setEditorRef(editor);

  useEffect(() => {
    window.api.onEditorZoomIn(() =>
      appContext.modifyPrefs((p) => {
        if (p.editor.zoom <= 5.0) p.editor.zoom += 0.1;
      })
    );
    window.api.onEditorZoomOut(() =>
      appContext.modifyPrefs((p) => {
        if (p.editor.zoom >= 0.2) p.editor.zoom -= 0.1;
      })
    );
    window.api.onEditorResetZoom(() =>
      appContext.modifyPrefs((p) => {
        p.editor.zoom = 1.0;
      })
    );
  }, [appContext]);

  if (editor != null) {
    return (
      <EditorStyles>
        <Toolbar editor={editor} />

        <TableOfContents editor={editor} />

        <Container
          size={appContext.prefs.editor.width}
          py="xl"
          style={{ zoom: appContext.prefs.editor.zoom }}
        >
          <Paper
            withBorder={appContext.prefs.editor.border}
            shadow={appContext.prefs.editor.border ? "sm" : undefined}
            px="xl"
            py="md"
          >
            <EditorContent
              id="tiptap-editor"
              editor={editor}
              spellCheck={appContext.prefs.editor.spellcheck.toString() as "true" | "false"}
            />
          </Paper>
        </Container>
      </EditorStyles>
    );
  } else return <></>;
}
