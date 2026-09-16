# Iosevka Aile webfonts.
#
# The UI needs two faces and no others: Regular for body text and SemiBold for
# the handful of places weight marks a heading (`--font` in src/style.css is
# 400; the six `font-weight: 600` rules in DataViewer, Dropdown and
# QueryProgress are the other one). Nothing uses 700, so Bold is not built.
#
# Nothing here is checked in on the input side: the release is fetched from
# GitHub, unpacked into $(WORK), and subset from there. Only the two .woff2
# and the hand-written CSS beside them live in the tree.
#
#   make fonts             build src/lib/assets/fonts/*.woff2
#   make fonts-info        report size, coverage and hinting of what was built
#   make fonts-clean       remove the built .woff2
#   make fonts-distclean   also remove the download cache
#
# Bumping IOSEVKA_VERSION changes $(ZIP)'s filename, which is what makes the
# download, the extraction and both subsets fall out of date together.

IOSEVKA_VERSION ?= 34.8.1
FONT_DIR        ?= src/lib/assets/fonts
WORK            ?= .fontbuild

# PkgTTF is the smallest release asset that is still hinted (83.7 MB, against
# 129.7 MB for PkgWebFont, whose .woff2 we would only unpack and rewrite
# anyway). "Unhinted" variants are smaller again and are the wrong trade at
# 11-13px on Windows — see the --layout-features note below.
ZIP := $(WORK)/PkgTTF-IosevkaAile-$(IOSEVKA_VERSION).zip
URL := https://github.com/be5invis/Iosevka/releases/download/v$(IOSEVKA_VERSION)/PkgTTF-IosevkaAile-$(IOSEVKA_VERSION).zip

TTF := $(WORK)/ttf

# uv is the only thing that has to be installed: it fetches its own
# interpreter and resolves fonttools into an ephemeral environment, so there
# is no venv in the tree to go stale and nothing to invalidate when a version
# below changes. Both are pinned because the .woff2 are checked in — an
# unpinned toolchain would rewrite those bytes on somebody else's machine and
# the diff would be noise. uv's cache is global (~/.cache/uv), which is why
# fonts-distclean leaves it alone.
UV                ?= uv
PYTHON_VERSION    ?= 3.14
FONTTOOLS_VERSION ?= 4.65.0

RUN := $(UV) run --no-project --quiet \
	--python $(PYTHON_VERSION) \
	--with fonttools==$(FONTTOOLS_VERSION) --with brotli

FONTS := $(FONT_DIR)/iosevka-aile-400.woff2 $(FONT_DIR)/iosevka-aile-600.woff2

# `--unicodes='*'` keeps every one of the 7582 codepoints the font ships, so
# nothing a result cell can contain stops rendering. The saving is not
# characters, it is glyphs: the release carries 48373 glyphs for those 7582
# codepoints, the surplus being alternates behind 192 opt-in OpenType features
# (cv01-cv99, ss01-ss20, the per-language ligature packs, fractions, oldstyle
# figures). A browser applies none of them without font-feature-settings or
# font-variant-*, so dropping them is invisible: 1614 KB becomes 354 KB with
# an identical cmap and identical default rendering.
#
# What is kept is exactly the set this font applies by default -- ccmp and
# locl, calt, and mark/mkmk, which position combining diacritics and are what
# keeps stacked-accent text correct -- plus `zero`, which is opt-in but cheap
# and the one we might reach for. Do not add `kern`, `liga` or `tnum`: this
# font has none of them. Aile's advances are quantized to tenths of an em so
# it does not kern, its ligatures live in the mono family, and its digits are
# all 600 units already, which is why `font-variant-numeric: tabular-nums` in
# Table and QueryProgress still lines up without a `tnum` to apply.
#
# Hinting is deliberately NOT stripped. --no-hinting saves a further 102 KB
# per face by dropping fpgm/prep/cvt, and that is the one cut here anyone
# could see: macOS ignores TrueType instructions and DirectWrite mostly
# substitutes its own, but at the 11-13px this UI runs at on Windows at
# standard DPI, stem alignment is exactly where they still tell.
SUBSET_FLAGS := \
	--flavor=woff2 \
	--unicodes='*' \
	--layout-features='ccmp,locl,calt,mark,mkmk,zero'

.DEFAULT_GOAL := fonts
.PHONY: fonts fonts-info fonts-clean fonts-distclean

fonts: $(FONTS)

$(FONT_DIR)/iosevka-aile-400.woff2: $(TTF)/IosevkaAile-Regular.ttf
	@mkdir -p $(@D)
	$(RUN) pyftsubset $< --output-file=$@ $(SUBSET_FLAGS)

$(FONT_DIR)/iosevka-aile-600.woff2: $(TTF)/IosevkaAile-SemiBold.ttf
	@mkdir -p $(@D)
	$(RUN) pyftsubset $< --output-file=$@ $(SUBSET_FLAGS)

# The archive is flat, so one member can be pulled out by name. unzip restores
# the member's recorded mtime, which predates the download and would leave the
# .ttf looking older than the .zip it came from -- hence the touch, without
# which every run re-extracts.
$(TTF)/IosevkaAile-%.ttf: $(ZIP)
	@mkdir -p $(@D)
	unzip -joq $< 'IosevkaAile-$*.ttf' -d $(@D)
	@touch $@

# Downloaded to .part and renamed, so an interrupted transfer is not left
# behind looking like a complete archive. -f so an HTTP error is a failure
# rather than an error page saved under the .zip name.
$(ZIP):
	@mkdir -p $(@D)
	curl -fL --progress-bar -o $@.part $(URL)
	@mv $@.part $@

# Keep the extracted .ttf: as the middle of a chain made by a pattern rule it
# is an intermediate, which make would otherwise delete on the way out and
# re-extract from the archive on the next run.
.SECONDARY: $(TTF)/IosevkaAile-Regular.ttf $(TTF)/IosevkaAile-SemiBold.ttf

define FONT_INFO_PY
import os, sys
from fontTools.ttLib import TTFont
for path in sys.argv[1:]:
    font = TTFont(path)
    print("%-28s %6d KB  %5d codepoints  hinted: %s"
          % (os.path.basename(path), os.path.getsize(path) // 1024,
             len(font.getBestCmap()), "yes" if "fpgm" in font else "no"))
endef
export FONT_INFO_PY

fonts-info: $(FONTS)
	@$(RUN) python -c "$$FONT_INFO_PY" $(FONTS)

fonts-clean:
	rm -f $(FONTS)

fonts-distclean: fonts-clean
	rm -rf $(WORK)
