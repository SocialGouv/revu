# PR Validation Guardrails

## Overview

The Revu bot includes intelligent PR validation guardrails that automatically identify and skip reviewing PRs that are unsuitable for automated code review. This helps ensure the bot focuses on PRs where it can provide the most value while avoiding wasted resources on problematic PRs.

**Important**: Binary and generated files (images, lock files, build artifacts, etc.) are now automatically filtered out during review using the `.revuignore` file, rather than causing entire PRs to be skipped. This means PRs with legitimate code changes alongside binary/generated files will still be reviewed.

## What PRs Are Skipped?

The bot will skip reviewing PRs that meet any of these criteria:

### 1. **Large-Scale Changes**

- **Too many files changed**: PRs with more than 75 files (configurable)
- **Massive diffs**: PRs with more than 15,000 lines of diff (configurable)
- **Individual file too large**: Single files with more than 3,000 lines of changes (configurable)

### 2. **Documentation-Only PRs**

- **Documentation-only**: PRs that only change documentation files (.md, .txt, etc.) when configured to skip them

## File Filtering vs PR Skipping

### Files Automatically Filtered (Not Skipped)

The following file types are **filtered out during review** using the `.revuignore` file, but don't cause PR rejection:

#### Generated Files

- `*.lock` files (package-lock.json, yarn.lock, etc.)
- `*.generated.*` and `*-generated.*` files
- Build directories: `dist/`, `build/`, `coverage/`, `target/`
- Dependency directories: `node_modules/`, `.next/`, `.nuxt/`
- Minified files: `*.min.js`, `*.min.css`, `*.bundle.*`

#### Binary Files

- Images: `.jpg`, `.png`, `.gif`, `.svg`, etc.
- Documents: `.pdf`, `.doc`, `.docx`, `.xls`, etc.
- Archives: `.zip`, `.tar`, `.gz`, etc.
- Media: `.mp3`, `.mp4`, `.avi`, etc.
- Fonts: `.woff`, `.ttf`, `.eot`, etc.

### Benefits of File Filtering

- **Better user experience**: PRs with legitimate code changes are still reviewed
- **Focused reviews**: Only meaningful code files are analyzed
- **No false rejections**: Binary assets don't prevent code review
- **Comprehensive filtering**: Uses battle-tested `.revuignore` patterns

## When PRs Are Skipped

When a PR is skipped, the bot will:

1. **Post an informative comment** explaining why the review was skipped
2. **Provide specific metrics** about the PR (total files, reviewable files, diff size, etc.)
3. **Suggest improvements** to make the PR more suitable for review
4. **Include configuration guidance** for adjusting the limits

### Example Skip Comment

```markdown
## ⚠️ PR Review Skipped

**Reason:** This PR changes 150 files, which exceeds the limit of 75 files.

**Suggestion:** Consider breaking this PR into smaller, more focused changes. Large PRs are harder to review effectively and may contain unrelated changes.

### PR Metrics
- **Total files changed:** 150
- **Reviewable files:** 45
- **Diff size:** 8,500 lines
- **Documentation files:** 12
- **Largest file change:** 2,100 lines
- **Addition/Deletion ratio:** 4.2

---
*This validation helps ensure the bot focuses on PRs where automated review provides the most value. You can adjust these limits in your `.revu.yml` configuration file.*
```

## Configuration

You can customize validation settings in your `.revu.yml` file:

```yaml
validation:
  # File count limits
  maxFilesChanged: 75
  maxDiffSize: 15000
  maxIndividualFileSize: 3000

  # Addition/deletion ratio limits
  minAdditionDeletionRatio: 0.1  # Skip mostly-deletion PRs
  maxAdditionDeletionRatio: 10   # Skip mostly-addition PRs

  # Content type settings
  skipDocumentationOnly: true

  # Documentation file extensions
  documentationExtensions:
    - ".md"
    - ".txt"
    - ".rst"
    - ".adoc"
    - ".tex"

# Note: Binary and generated files are automatically filtered using .revuignore
# This provides better file filtering without skipping entire PRs
```

### File Filtering Configuration

Binary and generated files are filtered using the `.revuignore` file (similar to `.gitignore`). You can customize this by creating a `.revuignore` file in your repository:

```gitignore
# Lock files and package management
*.lock
yarn.lock
package-lock.json

# Generated files and build artifacts
dist/
build/
coverage/
*.min.js
*.min.css
*.bundle.*

# Binary files
*.jpg
*.png
*.pdf
*.zip

# Add your custom patterns here
```

## Benefits

### 1. **Resource Efficiency**

- Saves API costs by avoiding expensive Claude calls on unsuitable PRs
- Reduces processing time and server load
- Prevents unnecessary repository cloning and file processing

### 2. **Better User Experience**

- Reviews PRs with legitimate code changes even if they contain binary/generated files
- Provides immediate feedback on why PRs aren't reviewed
- Offers actionable suggestions for improving PR structure
- Reduces noise from unhelpful automated reviews

### 3. **Focus on Value**

- Ensures the bot reviews PRs where it can provide meaningful feedback
- Automatically filters out generated code that doesn't benefit from review
- Concentrates on actual code changes that need careful examination
- Maintains review coverage for mixed PRs (code + assets)

## Implementation Details

### Architecture

- **PRValidationService**: Core validation logic with configurable rules
- **File filtering integration**: Uses existing `.revuignore` system for comprehensive filtering
- **Early validation**: Runs before expensive operations (cloning, file reading, API calls)
- **Fail-open design**: If validation fails due to errors, the review proceeds normally
- **Comprehensive metrics**: Detailed analysis of PR characteristics

### File Processing Flow

1. **Extract all changed files** from PR diff
2. **Apply validation rules** on total file count and diff size
3. **Filter files** using `.revuignore` patterns during review
4. **Review only meaningful files** while tracking both total and reviewable counts

### Error Handling

- Validation errors don't block reviews (fail-open approach)
- Detailed logging for debugging validation issues
- Graceful degradation when GitHub API calls fail

### Testing

- 15 comprehensive test cases covering all validation scenarios
- Updated tests reflect new file filtering approach
- Mock-based testing for reliable CI/CD integration

## Monitoring and Metrics

The validation service provides detailed metrics for each PR:

- **Total files changed** (all files in the diff)
- **Reviewable files changed** (after filtering)
- **Total diff size**
- **Largest individual file change**
- **Addition/deletion ratio**
- **Documentation files count**

These metrics are included in skip comments and logged for monitoring purposes.

## Migration from Previous Versions

If you're upgrading from a previous version that used binary/generated file patterns in `.revu.yml`:

1. **Remove old patterns**: The `binaryFileExtensions` and `generatedFilePatterns` configurations are no longer used
2. **Update .revuignore**: The comprehensive patterns are now in the default `.revuignore` file
3. **Test your setup**: PRs that were previously skipped may now be reviewed (which is the intended improvement)

The new approach provides better coverage while maintaining the same filtering quality.
