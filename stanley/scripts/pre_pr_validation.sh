#!/bin/bash

# Pre-PR Validation Script for Stanley
# Run this script before submitting a PR to ensure all checks pass
# Usage: ./scripts/pre_pr_validation.sh

set -e  # Exit on first error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASS=0
FAIL=0
WARN=0

# Functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((PASS++))
}

print_fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    ((FAIL++))
}

print_warn() {
    echo -e "${YELLOW}⚠ WARN${NC}: $1"
    ((WARN++))
}

print_info() {
    echo -e "${BLUE}ℹ INFO${NC}: $1"
}

# Check if we're in the right directory
if [ ! -f "pyproject.toml" ] && [ ! -f "stanley-gui/Cargo.toml" ]; then
    echo -e "${RED}Error: This script must be run from the Stanley root directory${NC}"
    exit 1
fi

print_header "Stanley Pre-PR Validation"
print_info "This script validates your PR is ready for submission"
echo "Started at: $(date)"

# ===== SECTION 1: Git Status =====
print_header "1. Git Status Checks"

# Check if on a proper branch
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [[ $current_branch == "main" || $current_branch == "master" ]]; then
    print_fail "You are on $current_branch branch. Create a feature branch first."
else
    print_pass "On feature branch: $current_branch"
fi

# Check for uncommitted changes (excluding .env)
if git diff --quiet -- ':!.env'; then
    print_pass "No uncommitted changes"
else
    print_warn "Uncommitted changes exist (excluding .env)"
fi

# Check branch is up to date
git fetch origin main > /dev/null 2>&1
if ! git diff --quiet origin/main..HEAD -- 2>/dev/null; then
    print_info "Your branch has commits not in main (expected)"
else
    print_warn "Branch appears to have no new commits"
fi

# Check for recent commits
commit_count=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo "0")
if [ "$commit_count" -gt "0" ]; then
    print_pass "Found $commit_count commits to submit"
else
    print_fail "No commits found to submit"
fi

# ===== SECTION 2: Python Code Quality =====
print_header "2. Python Code Quality Checks"

if command -v black &> /dev/null; then
    if black --check stanley/ 2>/dev/null; then
        print_pass "Black formatting check passed"
    else
        print_fail "Black formatting issues found. Run: black stanley/"
    fi
else
    print_warn "Black not installed. Run: pip install black"
fi

if command -v flake8 &> /dev/null; then
    if flake8_output=$(flake8 stanley/ 2>&1); then
        print_pass "Flake8 linting passed"
    else
        print_fail "Flake8 found issues:"
        echo "$flake8_output" | head -20
    fi
else
    print_warn "Flake8 not installed. Run: pip install flake8"
fi

if command -v mypy &> /dev/null; then
    if mypy_output=$(mypy stanley/ 2>&1); then
        print_pass "MyPy type checking passed"
    else
        print_fail "MyPy found issues:"
        echo "$mypy_output" | head -20
    fi
else
    print_warn "MyPy not installed. Run: pip install mypy"
fi

# ===== SECTION 3: Python Testing =====
print_header "3. Python Testing"

if command -v pytest &> /dev/null; then
    print_info "Running pytest..."
    if pytest_output=$(pytest tests/ -v 2>&1); then
        # Extract test counts from output
        if [[ $pytest_output =~ passed ]]; then
            print_pass "All pytest tests passed"
        else
            print_warn "Pytest output unclear"
        fi
    else
        print_fail "Pytest tests failed. Run: pytest tests/ -v"
        echo "$pytest_output" | tail -30
    fi

    # Check coverage
    print_info "Checking test coverage..."
    if coverage_output=$(pytest tests/ --cov=stanley --cov-report=term-missing 2>&1); then
        # Try to extract coverage percentage
        if [[ $coverage_output =~ TOTAL.*[0-9]+% ]]; then
            coverage_line=$(echo "$coverage_output" | grep TOTAL)
            print_pass "Coverage report: $coverage_line"
        fi
    else
        print_warn "Could not generate coverage report"
    fi
else
    print_warn "Pytest not installed. Run: pip install pytest pytest-cov"
fi

# ===== SECTION 4: Rust Code Quality =====
print_header "4. Rust Code Quality Checks (if modified)"

if [ -d "stanley-gui" ]; then
    cd stanley-gui

    if command -v cargo &> /dev/null; then
        print_info "Found Rust project, running checks..."

        if cargo fmt -- --check 2>/dev/null; then
            print_pass "Cargo fmt check passed"
        else
            print_fail "Cargo format issues found. Run: cargo fmt"
        fi

        if cargo_output=$(cargo clippy -- -D warnings 2>&1); then
            print_pass "Cargo clippy check passed"
        else
            print_fail "Cargo clippy found issues"
            echo "$cargo_output" | head -20
        fi

        if cargo test --verbose 2>/dev/null > /dev/null; then
            print_pass "Cargo tests passed"
        else
            print_fail "Cargo tests failed. Run: cargo test --verbose"
        fi
    else
        print_warn "Cargo not found. Rust checks skipped."
    fi

    cd - > /dev/null
else
    print_info "No Rust project found. Skipping Rust checks."
fi

# ===== SECTION 5: Security Checks =====
print_header "5. Security Checks"

# Check for secrets
print_info "Scanning for potential secrets..."
if grep -r "PRIVATE_KEY\|SECRET_KEY\|API_KEY\|PASSWORD" stanley/ 2>/dev/null | grep -v ".pyc\|__pycache__" | grep "=.*['\"]"; then
    print_fail "Potential secrets found in code"
else
    print_pass "No obvious hardcoded secrets detected"
fi

# Check for .env in .gitignore
if grep -q "\.env" .gitignore 2>/dev/null; then
    print_pass ".env is in .gitignore"
else
    print_warn ".env may not be properly ignored"
fi

# Check for pip audit (if available)
if command -v pip-audit &> /dev/null; then
    print_info "Checking for vulnerable dependencies..."
    if pip-audit 2>&1 | grep -q "No known vulnerabilities"; then
        print_pass "No known vulnerabilities in dependencies"
    else
        print_warn "Check pip-audit output for vulnerabilities"
    fi
fi

# ===== SECTION 6: Documentation =====
print_header "6. Documentation Checks"

# Check for docstrings in Python files
python_files=$(find stanley -name "*.py" -type f ! -path "*/__pycache__/*" | wc -l)
if [ "$python_files" -gt "0" ]; then
    print_info "Found $python_files Python files"
    # Count files with docstrings (basic check)
    documented_files=$(grep -l '"""' stanley/**/*.py 2>/dev/null | wc -l)
    if [ "$documented_files" -gt "0" ]; then
        print_pass "Documentation strings found in $documented_files files"
    else
        print_warn "Consider adding docstrings to public functions"
    fi
fi

# Check for CHANGELOG update
if [ -f "CHANGELOG.md" ]; then
    print_info "CHANGELOG.md exists"
    print_warn "Remember to update CHANGELOG.md if this is a user-facing change"
fi

# ===== SECTION 7: Commit Messages =====
print_header "7. Commit Message Validation"

commits=$(git rev-list origin/main..HEAD 2>/dev/null || echo "")
if [ -n "$commits" ]; then
    print_info "Validating commit messages..."
    valid_types="feat|fix|docs|style|refactor|test|chore"
    invalid_commits=0

    while IFS= read -r commit; do
        commit_hash=$(echo "$commit" | cut -d' ' -f1)
        commit_msg=$(git log -1 --format=%B "$commit_hash" | head -1)

        if [[ $commit_msg =~ ^(feat|fix|docs|style|refactor|test|chore) ]]; then
            # Valid conventional commit
            true
        else
            print_warn "Commit '$commit_msg' may not follow Conventional Commits"
            ((invalid_commits++))
        fi
    done < <(git rev-list origin/main..HEAD)

    if [ "$invalid_commits" -eq "0" ]; then
        print_pass "All commits follow Conventional Commits format"
    else
        print_warn "$invalid_commits commits may need message updates"
    fi
fi

# ===== SECTION 8: Branch Status =====
print_header "8. Branch Status"

origin_main_commit=$(git rev-parse origin/main 2>/dev/null)
local_commit=$(git rev-parse HEAD)

if [ "$origin_main_commit" = "$local_commit" ]; then
    print_warn "Your branch is on same commit as origin/main"
else
    print_pass "Your branch has commits ready to submit"
fi

# Check for merge conflicts
if [ -f ".git/MERGE_HEAD" ]; then
    print_fail "Merge in progress. Resolve conflicts first."
else
    print_pass "No merge conflicts detected"
fi

# ===== SUMMARY =====
print_header "Validation Summary"

echo -e "Passed:  ${GREEN}$PASS${NC}"
echo -e "Failed:  ${RED}$FAIL${NC}"
echo -e "Warnings: ${YELLOW}$WARN${NC}"

echo ""
if [ "$FAIL" -eq "0" ]; then
    if [ "$WARN" -eq "0" ]; then
        echo -e "${GREEN}✓ All checks passed! Your PR is ready to submit.${NC}"
        exit 0
    else
        echo -e "${YELLOW}⚠ Checks passed with $WARN warning(s). Review them above.${NC}"
        exit 0
    fi
else
    echo -e "${RED}✗ $FAIL check(s) failed. Fix issues above before submitting PR.${NC}"
    exit 1
fi
