import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import { useEffect, useRef } from 'react'

interface Props {
  html: string
  onSave: (html: string) => void
}

const NOTE_COLORS = ['#222222', '#ff3c3c', '#2d6bff', '#f5c518', '#39ff14']

export function NoteEditor({ html, onSave }: Props) {
  const saveTimer = useRef<number | null>(null)

  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color],
    content: html,
    onUpdate: ({ editor }) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => onSave(editor.getHTML()), 800)
    },
  })

  // Reset editor content when switching to a different page.
  useEffect(() => {
    if (editor && html !== editor.getHTML()) {
      editor.commands.setContent(html, { emitUpdate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html])

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [])

  if (!editor) return null

  return (
    <div className="note-editor">
      <div className="note-toolbar">
        <button
          type="button"
          className={editor.isActive('bold') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </button>
        <button
          type="button"
          className={editor.isActive('italic') ? 'active' : ''}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </button>
        {NOTE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="swatch"
            style={{ background: c }}
            onClick={() => editor.chain().focus().setColor(c).run()}
          />
        ))}
      </div>
      <EditorContent editor={editor} className="note-content" />
    </div>
  )
}
