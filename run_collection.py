import argparse
import os
import json
import glob
import hashlib
from datetime import datetime
from pageindex import page_index_main, config
from pageindex.page_index_md import md_to_tree
from pageindex.utils import ConfigLoader
import asyncio

MANIFEST_FILE = "_collection_manifest.json"

def get_file_hash(filepath):
    """Calculate MD5 hash of a file for change detection."""
    hasher = hashlib.md5()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            hasher.update(chunk)
    return hasher.hexdigest()

def get_file_info(filepath):
    """Get file metadata for tracking."""
    stat = os.stat(filepath)
    return {
        'path': os.path.abspath(filepath),
        'hash': get_file_hash(filepath),
        'size': stat.st_size,
        'modified': stat.st_mtime,
        'indexed_at': datetime.now().isoformat()
    }

def load_manifest(collection_dir):
    """Load the collection manifest tracking indexed files."""
    manifest_path = os.path.join(collection_dir, MANIFEST_FILE)
    if os.path.exists(manifest_path):
        with open(manifest_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {'files': {}, 'created_at': datetime.now().isoformat()}

def save_manifest(collection_dir, manifest):
    """Save the collection manifest."""
    manifest_path = os.path.join(collection_dir, MANIFEST_FILE)
    manifest['updated_at'] = datetime.now().isoformat()
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)

def get_source_files(input_dir):
    """Get all PDF and Markdown files from input directory."""
    files = {}
    for ext in ['*.pdf', '*.PDF', '*.md', '*.markdown']:
        for filepath in glob.glob(os.path.join(input_dir, ext)):
            doc_id = os.path.splitext(os.path.basename(filepath))[0]
            files[doc_id] = filepath
    return files

def process_pdf(filepath, output_dir, args):
    """Process a single PDF file."""
    opt = config(
        model=args.model,
        toc_check_page_num=args.toc_check_pages,
        max_page_num_each_node=args.max_pages_per_node,
        max_token_num_each_node=args.max_tokens_per_node,
        if_add_node_id='yes',
        if_add_node_summary='yes',
        if_add_doc_description='yes',
        if_add_node_text='no'
    )

    result = page_index_main(filepath, opt)

    doc_name = os.path.splitext(os.path.basename(filepath))[0]
    output_file = os.path.join(output_dir, f'{doc_name}_structure.json')

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2)

    return output_file

def process_markdown(filepath, output_dir, args):
    """Process a single Markdown file."""
    config_loader = ConfigLoader()
    user_opt = {
        'model': args.model,
        'if_add_node_summary': 'yes',
        'if_add_doc_description': 'yes',
        'if_add_node_text': 'no',
        'if_add_node_id': 'yes'
    }
    opt = config_loader.load(user_opt)

    result = asyncio.run(md_to_tree(
        md_path=filepath,
        if_thinning=False,
        min_token_threshold=5000,
        if_add_node_summary=opt.if_add_node_summary,
        summary_token_threshold=200,
        model=opt.model,
        if_add_doc_description=opt.if_add_doc_description,
        if_add_node_text=opt.if_add_node_text,
        if_add_node_id=opt.if_add_node_id
    ))

    doc_name = os.path.splitext(os.path.basename(filepath))[0]
    output_file = os.path.join(output_dir, f'{doc_name}_structure.json')

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    return output_file

def ingest_file(filepath, output_dir, args):
    """Ingest a single file (PDF or Markdown)."""
    if filepath.lower().endswith('.pdf'):
        return process_pdf(filepath, output_dir, args)
    elif filepath.lower().endswith(('.md', '.markdown')):
        return process_markdown(filepath, output_dir, args)
    else:
        raise ValueError(f"Unsupported file type: {filepath}")

def sync_collection(input_dir, output_dir, args):
    """Sync a collection with source folder - add new, update changed, remove deleted."""
    os.makedirs(output_dir, exist_ok=True)

    manifest = load_manifest(output_dir)
    source_files = get_source_files(input_dir)

    # Track changes
    to_add = []
    to_update = []
    to_remove = []
    unchanged = []

    # Check for new and updated files
    for doc_id, filepath in source_files.items():
        file_info = get_file_info(filepath)

        if doc_id not in manifest['files']:
            to_add.append((doc_id, filepath, file_info))
        elif manifest['files'][doc_id]['hash'] != file_info['hash']:
            to_update.append((doc_id, filepath, file_info))
        else:
            unchanged.append(doc_id)

    # Check for removed files
    for doc_id in manifest['files']:
        if doc_id not in source_files:
            to_remove.append(doc_id)

    # Report status
    print(f"\nCollection sync status:")
    print(f"  New files:       {len(to_add)}")
    print(f"  Updated files:   {len(to_update)}")
    print(f"  Removed files:   {len(to_remove)}")
    print(f"  Unchanged files: {len(unchanged)}")

    if not to_add and not to_update and not to_remove:
        print("\nCollection is already up to date.")
        return

    # Process new files
    for doc_id, filepath, file_info in to_add:
        print(f"\n[ADD] Processing: {doc_id}")
        try:
            ingest_file(filepath, output_dir, args)
            manifest['files'][doc_id] = file_info
            print(f"  Done: {doc_id}_structure.json")
        except Exception as e:
            print(f"  Error: {e}")

    # Process updated files
    for doc_id, filepath, file_info in to_update:
        print(f"\n[UPDATE] Processing: {doc_id}")
        try:
            ingest_file(filepath, output_dir, args)
            manifest['files'][doc_id] = file_info
            print(f"  Done: {doc_id}_structure.json")
        except Exception as e:
            print(f"  Error: {e}")

    # Remove deleted files
    for doc_id in to_remove:
        print(f"\n[REMOVE] {doc_id}")
        structure_file = os.path.join(output_dir, f'{doc_id}_structure.json')
        if os.path.exists(structure_file):
            os.remove(structure_file)
            print(f"  Deleted: {doc_id}_structure.json")
        del manifest['files'][doc_id]

    # Save updated manifest
    save_manifest(output_dir, manifest)
    print(f"\nSync complete. Collection manifest updated.")

def ingest_folder(input_dir, output_dir, args):
    """Ingest all files from input folder (full re-index)."""
    os.makedirs(output_dir, exist_ok=True)

    source_files = get_source_files(input_dir)

    if not source_files:
        print(f"No PDF or Markdown files found in: {input_dir}")
        return

    print(f"Found {len(source_files)} file(s) to process")

    manifest = {'files': {}, 'created_at': datetime.now().isoformat()}

    for i, (doc_id, filepath) in enumerate(source_files.items(), 1):
        print(f"\n[{i}/{len(source_files)}] Processing: {doc_id}")
        try:
            ingest_file(filepath, output_dir, args)
            manifest['files'][doc_id] = get_file_info(filepath)
            print(f"  Done: {doc_id}_structure.json")
        except Exception as e:
            print(f"  Error: {e}")

    save_manifest(output_dir, manifest)
    print(f"\nIngestion complete. Processed {len(manifest['files'])} file(s).")

def show_status(collection_dir, input_dir=None):
    """Show collection status."""
    manifest = load_manifest(collection_dir)

    print(f"\nCollection: {collection_dir}")
    print(f"Created:    {manifest.get('created_at', 'Unknown')}")
    print(f"Updated:    {manifest.get('updated_at', 'Never')}")
    print(f"Documents:  {len(manifest['files'])}")

    if manifest['files']:
        print(f"\nIndexed documents:")
        for doc_id, info in manifest['files'].items():
            print(f"  - {doc_id}")
            print(f"      Source: {info.get('path', 'Unknown')}")
            print(f"      Indexed: {info.get('indexed_at', 'Unknown')}")

    if input_dir:
        source_files = get_source_files(input_dir)
        new_files = [f for f in source_files if f not in manifest['files']]
        removed = [f for f in manifest['files'] if f not in source_files]

        changed = []
        for doc_id, filepath in source_files.items():
            if doc_id in manifest['files']:
                current_hash = get_file_hash(filepath)
                if current_hash != manifest['files'][doc_id]['hash']:
                    changed.append(doc_id)

        if new_files or removed or changed:
            print(f"\nPending changes (run --sync to apply):")
            for f in new_files:
                print(f"  [NEW] {f}")
            for f in changed:
                print(f"  [MODIFIED] {f}")
            for f in removed:
                print(f"  [DELETED] {f}")
        else:
            print(f"\nCollection is in sync with source folder.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Manage PageIndex collections')

    parser.add_argument('--input-dir', type=str,
                      help='Source folder containing PDF/Markdown files')
    parser.add_argument('--output-dir', type=str, required=True,
                      help='Collection output directory')

    # Actions
    parser.add_argument('--ingest', action='store_true',
                      help='Ingest all files from input-dir (full re-index)')
    parser.add_argument('--sync', action='store_true',
                      help='Sync collection: add new, update changed, remove deleted')
    parser.add_argument('--status', action='store_true',
                      help='Show collection status')

    # Processing options
    parser.add_argument('--model', type=str, default='gpt-4o-2024-11-20',
                      help='Model to use')
    parser.add_argument('--toc-check-pages', type=int, default=20,
                      help='Pages to check for TOC (PDF only)')
    parser.add_argument('--max-pages-per-node', type=int, default=10,
                      help='Max pages per node (PDF only)')
    parser.add_argument('--max-tokens-per-node', type=int, default=20000,
                      help='Max tokens per node (PDF only)')

    args = parser.parse_args()

    # Validate arguments
    if not args.ingest and not args.sync and not args.status:
        parser.error("Specify an action: --ingest, --sync, or --status")

    if (args.ingest or args.sync) and not args.input_dir:
        parser.error("--input-dir is required for --ingest and --sync")

    if args.input_dir and not os.path.isdir(args.input_dir):
        parser.error(f"Input directory not found: {args.input_dir}")

    # Execute action
    if args.status:
        show_status(args.output_dir, args.input_dir)
    elif args.ingest:
        ingest_folder(args.input_dir, args.output_dir, args)
    elif args.sync:
        sync_collection(args.input_dir, args.output_dir, args)
