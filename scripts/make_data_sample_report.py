import os
import glob
import argparse
from pathlib import Path
from tqdm import tqdm
import pandas as pd


def format_file_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024 ** 2:
        return f"{size_bytes / 1024:.1f} KB"
    if size_bytes < 1024 ** 3:
        return f"{size_bytes / (1024 ** 2):.1f} MB"
    return f"{size_bytes / (1024 ** 3):.1f} GB"


def read_csv_safely(path: str, n: int):
    encodings = ["utf-8-sig", "cp949", "euc-kr", "utf-8"]
    last_error = None

    for enc in encodings:
        try:
            head_df = pd.read_csv(path, nrows=n, encoding=enc, low_memory=False)
            # 전체 row count는 대용량 파일에서 메모리 부담을 줄이기 위해 chunksize로 계산
            total_rows = 0
            for chunk in pd.read_csv(path, encoding=enc, chunksize=100_000, low_memory=False):
                total_rows += len(chunk)
            return head_df, total_rows, enc, None
        except Exception as e:
            last_error = e

    return None, None, None, last_error


def read_excel_safely(path: str, n: int):
    try:
        xls = pd.ExcelFile(path)
        sheet_summaries = []
        for sheet in xls.sheet_names[:5]:
            df = pd.read_excel(path, sheet_name=sheet, nrows=n)
            sheet_summaries.append((sheet, df))
        return sheet_summaries, None
    except Exception as e:
        return None, e


def df_to_text(df: pd.DataFrame, max_col_width: int = 40) -> str:
    if df is None or df.empty:
        return "(데이터 없음)\n"

    display_df = df.copy()

    # 너무 긴 문자열은 자르기
    for col in display_df.columns:
        display_df[col] = display_df[col].astype(str).map(
            lambda x: x[:max_col_width] + "..." if len(x) > max_col_width else x
        )

    return display_df.to_string(index=False)


def make_report(data_dir: str, out_path: str, n: int):
    patterns = [
        os.path.join(data_dir, "**", "*.csv"),
        os.path.join(data_dir, "**", "*.xlsx"),
        os.path.join(data_dir, "**", "*.xls"),
    ]

    files = []
    for pattern in patterns:
        files.extend(glob.glob(pattern, recursive=True))

    files = sorted(files)

    lines = []
    lines.append("# 데이터 샘플 리포트")
    lines.append("")
    lines.append(f"- data_dir: {data_dir}")
    lines.append(f"- file_count: {len(files)}")
    lines.append(f"- head_n: {n}")
    lines.append("")

    current_folder = None

    for idx, file_path in enumerate(tqdm(files), start=1):
        path = Path(file_path)
        folder = str(path.parent)

        if folder != current_folder:
            current_folder = folder
            lines.append("")
            lines.append("=" * 120)
            lines.append(f"## 폴더: {folder}")
            lines.append("=" * 120)
            lines.append("")

        size = os.path.getsize(file_path)
        ext = path.suffix.lower()

        lines.append("-" * 120)
        lines.append(f"[{idx}] 파일: {file_path}")
        lines.append(f"크기: {format_file_size(size)}")
        lines.append(f"확장자: {ext}")
        lines.append("")

        if ext == ".csv":
            df, total_rows, enc, error = read_csv_safely(file_path, n)

            if error:
                lines.append("[ERROR] CSV 읽기 실패")
                lines.append(str(error))
                lines.append("")
                continue

            lines.append(f"인코딩: {enc}")
            lines.append(f"shape: rows={total_rows}, cols={len(df.columns)}")
            lines.append("컬럼:")
            for c in df.columns:
                lines.append(f"  - {c}")
            lines.append("")
            lines.append(f"HEAD {n}:")
            lines.append(df_to_text(df))
            lines.append("")

        elif ext in [".xlsx", ".xls"]:
            sheet_summaries, error = read_excel_safely(file_path, n)

            if error:
                lines.append("[ERROR] Excel 읽기 실패")
                lines.append(str(error))
                lines.append("")
                continue

            lines.append(f"sheet_count_sampled: {len(sheet_summaries)}")
            for sheet_name, df in sheet_summaries:
                lines.append("")
                lines.append(f"[Sheet] {sheet_name}")
                lines.append(f"cols={len(df.columns)}")
                lines.append("컬럼:")
                for c in df.columns:
                    lines.append(f"  - {c}")
                lines.append("")
                lines.append(f"HEAD {n}:")
                lines.append(df_to_text(df))
                lines.append("")

    out_parent = os.path.dirname(out_path)
    if out_parent:
        os.makedirs(out_parent, exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"[DONE] saved: {out_path}")
    print(f"[INFO] files: {len(files)}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default="../data/")
    parser.add_argument("--out", default="data_profile_report.txt")
    parser.add_argument("--n", type=int, default=5)
    args = parser.parse_args()

    make_report(args.data_dir, args.out, args.n)


if __name__ == "__main__":
    main()