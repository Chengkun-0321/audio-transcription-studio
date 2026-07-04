"""由 segments.json（單一真實來源）即時產生 TXT / SRT / DOCX。

TXT / DOCX 支援 timestamps 開關（前端「時間戳」勾選同步）：
關閉時文字接在一起輸出；有說話者識別時仍按說話者輪替分段。
SRT 格式本質需要時間軸，不受開關影響。
"""
from __future__ import annotations

import io
from typing import Optional

# 這些語言書寫時不以空格分詞，串接時不加分隔
_NO_SPACE_LANGS = ("zh", "ja", "ko")


def _ts_srt(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, rem = divmod(ms, 3600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _ts_short(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def _speaker(seg: dict) -> Optional[str]:
    return seg.get("speaker")


def _joiner(language: Optional[str]) -> str:
    return "" if (language or "").startswith(_NO_SPACE_LANGS) else " "


def _turns(segments: list[dict]) -> list[tuple[Optional[str], list[dict]]]:
    """連續同一說話者的 segments 併成一個輪替（無 speaker 視為同一輪）。"""
    turns: list[tuple[Optional[str], list[dict]]] = []
    for seg in segments:
        sp = _speaker(seg)
        if turns and turns[-1][0] == sp:
            turns[-1][1].append(seg)
        else:
            turns.append((sp, [seg]))
    return turns


def to_txt(segments: list[dict], timestamps: bool = True,
           language: Optional[str] = None) -> str:
    if timestamps:
        lines = []
        last_speaker = object()
        for seg in segments:
            sp = _speaker(seg)
            if sp is not None and sp != last_speaker:
                lines.append(f"\n[{sp}]")
                last_speaker = sp
            lines.append(f"[{_ts_short(seg['start'])}] {seg['text']}")
        return "\n".join(lines).strip() + "\n"

    join = _joiner(language)
    if not any(_speaker(s) for s in segments):
        return join.join(s["text"] for s in segments).strip() + "\n"
    paras = []
    for sp, segs in _turns(segments):
        text = join.join(s["text"] for s in segs)
        paras.append(f"[{sp}] {text}" if sp else text)
    return "\n\n".join(paras).strip() + "\n"


def to_srt(segments: list[dict]) -> str:
    blocks = []
    for i, seg in enumerate(segments, 1):
        sp = _speaker(seg)
        text = f"{sp}: {seg['text']}" if sp else seg["text"]
        blocks.append(f"{i}\n{_ts_srt(seg['start'])} --> {_ts_srt(seg['end'])}\n{text}\n")
    return "\n".join(blocks)


def to_docx(segments: list[dict], title: str, meta: dict,
            timestamps: bool = True, language: Optional[str] = None) -> bytes:
    from docx import Document
    from docx.shared import Pt, RGBColor

    doc = Document()
    doc.add_heading(title, level=1)

    info = doc.add_paragraph()
    run = info.add_run(
        f"時長 {_ts_short(meta.get('duration_seconds') or 0)}　"
        f"語言 {meta.get('language', '—')}　"
        f"轉錄模式 {meta.get('mode', '—')}　"
        f"建立於 {meta.get('created_at', '—')}"
    )
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0x88, 0x88, 0x88)

    if timestamps:
        for seg in segments:
            p = doc.add_paragraph()
            ts = p.add_run(f"[{_ts_short(seg['start'])}] ")
            ts.font.name = "Courier New"
            ts.font.size = Pt(9)
            ts.font.color.rgb = RGBColor(0x11, 0x8A, 0x7E)
            sp = _speaker(seg)
            if sp:
                sp_run = p.add_run(f"{sp}　")
                sp_run.bold = True
                sp_run.font.size = Pt(10)
            p.add_run(seg["text"]).font.size = Pt(11)
    else:
        join = _joiner(language)
        for sp, segs in _turns(segments):
            p = doc.add_paragraph()
            if sp:
                sp_run = p.add_run(f"{sp}　")
                sp_run.bold = True
                sp_run.font.size = Pt(10)
            p.add_run(join.join(s["text"] for s in segs)).font.size = Pt(11)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
