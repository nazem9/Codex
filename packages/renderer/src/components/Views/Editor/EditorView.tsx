import "./styles.scss";
import { Container, Paper } from "@mantine/core";
import { Page } from "common/Save";
import { useContext, useEffect, useMemo } from "react";
import { AppContext } from "types/AppStore";
import { Editor, EditorContent, useEditor } from "@tiptap/react";
import Toolbar from "./Toolbar/Toolbar";
import { extensions } from "./EditorExtensions";
import { TableOfContents } from "./TableOfContents";
import { EditorStyles } from "./EditorStyles";
import * as math from 'mathjs';

type Props = {
    page: Page;
    setEditorRef: (e: Editor | null) => void;
};

export function EditorView({ page, setEditorRef }: Props) {
    const appContext = useContext(AppContext);

    const _extensions = useMemo(
        () =>
            extensions({
                useTypography: appContext.prefs.editor.useTypographyExtension,
                tabSize: appContext.prefs.editor.tabSize
            }),
        [appContext.prefs.editor.tabSize, appContext.prefs.editor.useTypographyExtension]
    );

    const content = useMemo(() => JSON.parse(window.api.loadPage(page.fileName)), [page.fileName]);

    const editor = useEditor(
        {
            extensions: _extensions,
            autofocus: true,
            content: content,
            onUpdate: () => appContext.setUnsavedChanges(true)
        },
        [page.id]
    );

    // Function to parse and evaluate expressions
    const parseAndEvaluate = (content: string) => {
        return content.replace(/\{([^}]+)\}/g, (match: any, expression: math.MathExpression) => {
            try {
                const result = math.evaluate(expression);
                return result;
            } catch (error) {
                console.error(`Error evaluating expression: ${expression}`, error);
                return match;
            }
        });
    };

    useEffect(() => {
        if (editor) {
            const updateContent = () => {
                const selection = editor.state.selection;
                const start = selection.from;
                const end = selection.to;
                
                const str = editor.getHTML();
                const newContent = parseAndEvaluate(str);

                editor.commands.setContent(newContent, false, { preserveWhitespace: true });

                // Restore cursor position
                editor.commands.setTextSelection({ from: start, to: end });
            };

            editor.on('update', updateContent);
        }
    }, [editor]);

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
                            // Preact spellCheck workaround, must be a string not a boolean
                            spellCheck={
                                appContext.prefs.editor.spellcheck.toString() as "true" | "false"
                            }
                        />
                    </Paper>
                </Container>
            </EditorStyles>
        );
    } else return <></>;
}
