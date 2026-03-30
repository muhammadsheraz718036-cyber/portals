import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import {
  Bold,
  Italic,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Table as TableIcon,
  Undo,
  Redo,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Minus,
  Highlighter,
  Plus,
  Trash2,
  ArrowDown,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClick}
            disabled={disabled}
            className={cn(
              "h-8 w-8 p-0",
              active && "bg-accent text-accent-foreground",
            )}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {title}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function RichTextEditor({
  content,
  onChange,
  placeholder,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true, allowTableNodeSelection: true }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[300px] p-4 focus:outline-none [&_table]:border-collapse [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:bg-muted [&_th]:font-semibold",
      },
    },
  });

  // Update editor content when content prop changes
  useEffect(() => {
    if (editor && content !== undefined && content !== null) {
      const currentContent = editor.getHTML();
      if (currentContent !== content) {
        editor.commands.setContent(content);
      }
    }
  }, [editor, content]);

  if (!editor) return null;

  const iconSize = "h-4 w-4";

  return (
    <div className="border rounded-md overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 p-1.5 border-b bg-muted/30">
        {/* Undo/Redo */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
        >
          <Undo className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
        >
          <Redo className={iconSize} />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Headings */}
        <ToolbarButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          active={editor.isActive("heading", { level: 1 })}
          title="Heading 1"
        >
          <Heading1 className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          active={editor.isActive("heading", { level: 2 })}
          title="Heading 2"
        >
          <Heading2 className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
          active={editor.isActive("heading", { level: 3 })}
          title="Heading 3"
        >
          <Heading3 className={iconSize} />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Text formatting */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold"
        >
          <Bold className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic"
        >
          <Italic className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          title="Strikethrough"
        >
          <Strikethrough className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          active={editor.isActive("highlight")}
          title="Highlight"
        >
          <Highlighter className={iconSize} />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Alignment */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          active={editor.isActive({ textAlign: "left" })}
          title="Align Left"
        >
          <AlignLeft className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          active={editor.isActive({ textAlign: "center" })}
          title="Align Center"
        >
          <AlignCenter className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          active={editor.isActive({ textAlign: "right" })}
          title="Align Right"
        >
          <AlignRight className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
          active={editor.isActive({ textAlign: "justify" })}
          title="Justify"
        >
          <AlignJustify className={iconSize} />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Lists */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Bullet List"
        >
          <List className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Ordered List"
        >
          <ListOrdered className={iconSize} />
        </ToolbarButton>

        {/* Quote & HR */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          title="Blockquote"
        >
          <Quote className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal Rule"
        >
          <Minus className={iconSize} />
        </ToolbarButton>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {/* Table */}
        <ToolbarButton
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
          title="Insert Table"
        >
          <TableIcon className={iconSize} />
        </ToolbarButton>
        {editor.isActive("table") && (
          <>
            <ToolbarButton
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              title="Add Column"
            >
              <ArrowRight className={iconSize} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().addRowAfter().run()}
              title="Add Row"
            >
              <ArrowDown className={iconSize} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().deleteColumn().run()}
              title="Delete Column"
            >
              <Trash2 className={cn(iconSize, "text-destructive")} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().deleteRow().run()}
              title="Delete Row"
            >
              <Trash2 className={cn(iconSize, "text-destructive")} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().deleteTable().run()}
              title="Delete Table"
            >
              <Trash2 className={cn(iconSize, "text-destructive")} />
            </ToolbarButton>
          </>
        )}
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />
    </div>
  );
}
