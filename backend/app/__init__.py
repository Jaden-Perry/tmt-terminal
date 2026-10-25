import warnings

# yfinance still uses pandas' deprecated inplace= keyword; the warnings are noise, not errors.
warnings.filterwarnings("ignore", module=r"yfinance(\..*)?")
warnings.filterwarnings("ignore", message=".*inplace keyword.*")
warnings.filterwarnings("ignore", message="DataFrame columns are not unique")
