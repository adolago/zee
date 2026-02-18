from __future__ import annotations

import itertools
import json
import logging
import os
import urllib
from collections import defaultdict
from urllib.parse import urljoin

import pandas as pd
import requests
from tenacity import RetryError, TryAgain, after_log, retry, stop_after_attempt, wait_random_exponential

default_api_base_url = os.environ.get("API_URL") or "https://api.db.nomics.world/v22/"
default_max_nb_series = 50
default_editor_api_base_url = os.environ.get("EDITOR_API_URL") or "https://editor.nomics.world/api/v1/"
editor_apply_endpoint_nb_series_per_post = 100

default_timeout = 60


log = logging.getLogger(__name__)


class TooManySeries(Exception):
    def __init__(self, num_found, max_nb_series) -> None:
        self.num_found = num_found
        self.max_nb_series = max_nb_series
        message = (
            "DBnomics Web API found {num_found} series matching your request, "
            + (
                "but you passed the argument 'max_nb_series={max_nb_series}'."
                if max_nb_series is not None
                else "but you did not pass any value for the 'max_nb_series' argument, "
                "so a default value of {default_max_nb_series} was used."
            )
            + " Please give a higher value (at least max_nb_series={num_found}), and try again."
        ).format(
            default_max_nb_series=default_max_nb_series,
            max_nb_series=max_nb_series,
            num_found=num_found,
        )
        super().__init__(message)


def fetch_series(
    provider_code=None,
    dataset_code=None,
    series_code=None,
    dimensions=None,
    series_ids=None,
    max_nb_series=None,
    api_base_url=None,
    editor_api_base_url=default_editor_api_base_url,
    filters=None,
    timeout=None,
):
    """Download time series from DBnomics. Filter series by different ways according to the given parameters.

    If not `None`, `dimensions` parameter must be a `dict` of dimensions (`list` of `str`), like so:
    `{"freq": ["A", "M"], "country": ["FR"]}`.

    If not `None`, `series_code` must be a `str`. It can be a series code (one series), or a "mask" (many series):
    - remove a constraint on a dimension, for example `M..PCPIEC_WT`;
    - enumerate many values for a dimension, separated by a '+', for example `M.FR+DE.PCPIEC_WT`;
    - combine these possibilities many times in the same SDMX filter.

    If the rightmost dimension value code is removed, then the final '.' can be removed too: `A.FR.` = `A.FR`.

    If not `None`, `series_ids` parameter must be a non-empty `list` of series IDs.
    A series ID is a string formatted like `provider_code/dataset_code/series_code`.

    If `max_nb_series` is `None`, a default value of 50 series will be used.

    If `filters` is not `None`, apply those filters using the Time Series Editor API
    (Cf https://editor.nomics.world/filters)

    Return a Python Pandas `DataFrame`.

    Examples
    --------
    - fetch one series:
      fetch_series("AMECO/ZUTN/EA19.1.0.0.0.ZUTN")

    - fetch all the series of a dataset:
      fetch_series("AMECO", "ZUTN")

    - fetch many series from different datasets:
      fetch_series(["AMECO/ZUTN/EA19.1.0.0.0.ZUTN", "AMECO/ZUTN/DNK.1.0.0.0.ZUTN", "IMF/CPI/A.AT.PCPIT_IX"])

    - fetch many series from the same dataset, searching by dimension:
      fetch_series("AMECO", "ZUTN", dimensions={"geo": ["dnk"]})

    - fetch many series from the same dataset, searching by code mask:
      fetch_series("IMF", "CPI", series_code="M.FR+DE.PCPIEC_WT")
      fetch_series("IMF", "CPI", series_code=".FR.PCPIEC_WT")
      fetch_series("IMF", "CPI", series_code="M..PCPIEC_IX+PCPIA_IX")

    - fetch one series and apply interpolation filter:
      fetch_series(
          'AMECO/ZUTN/EA19.1.0.0.0.ZUTN',
          filters=[{"code": "interpolate", "parameters": {"frequency": "monthly", "method": "spline"}}],
      )

    """
    # Parameters validation
    if api_base_url is None:
        api_base_url = default_api_base_url
    if not api_base_url.endswith("/"):
        api_base_url += "/"
    if dataset_code is None:
        if isinstance(provider_code, list):
            series_ids = provider_code
            provider_code = None
        elif isinstance(provider_code, str):
            series_ids = [provider_code]
            provider_code = None

    if provider_code is not None and not isinstance(provider_code, str):
        msg = "`provider_code` parameter must be a string"
        raise ValueError(msg)
    if dataset_code is not None and not isinstance(dataset_code, str):
        msg = "`dataset_code` parameter must be a string"
        raise ValueError(msg)
    if dimensions is not None and not isinstance(dimensions, dict):
        msg = "`dimensions` parameter must be a dict"
        raise ValueError(msg)
    if series_code is not None and not isinstance(series_code, str):
        msg = "`series_code` parameter must be a string"
        raise ValueError(msg)
    if series_ids is not None and (
        not isinstance(series_ids, list) or any(not isinstance(series_id, str) for series_id in series_ids)
    ):
        msg = "`series_ids` parameter must be a list of strings"
        raise ValueError(msg)
    if api_base_url is not None and not isinstance(api_base_url, str):
        msg = "`api_base_url` parameter must be a string"
        raise ValueError(msg)

    series_base_url = urljoin(api_base_url, "series")

    if dimensions is None and series_code is None and series_ids is None:
        if not provider_code or not dataset_code:
            msg = "When you don't use `dimensions`, you must specifiy `provider_code` and `dataset_code`."
            raise ValueError(msg)
        api_link = series_base_url + f"/{provider_code}/{dataset_code}?observations=1"
        return fetch_series_by_api_link(
            api_link,
            filters=filters,
            max_nb_series=max_nb_series,
            editor_api_base_url=editor_api_base_url,
            timeout=timeout,
        )

    if dimensions is not None:
        if not provider_code or not dataset_code:
            msg = "When you use `dimensions`, you must specifiy `provider_code` and `dataset_code`."
            raise ValueError(msg)
        api_link = (
            series_base_url + f"/{provider_code}/{dataset_code}?observations=1&dimensions={json.dumps(dimensions)}"
        )
        return fetch_series_by_api_link(
            api_link,
            filters=filters,
            max_nb_series=max_nb_series,
            editor_api_base_url=editor_api_base_url,
            timeout=timeout,
        )

    if series_code is not None:
        if not provider_code or not dataset_code:
            msg = "When you use `series_code`, you must specifiy `provider_code` and `dataset_code`."
            raise ValueError(msg)
        api_link = series_base_url + f"/{provider_code}/{dataset_code}/{series_code}?observations=1"
        return fetch_series_by_api_link(
            api_link,
            filters=filters,
            max_nb_series=max_nb_series,
            editor_api_base_url=editor_api_base_url,
            timeout=timeout,
        )

    if series_ids is not None:
        if provider_code or dataset_code:
            msg = "When you use `series_ids`, you must not specifiy `provider_code` nor `dataset_code`."
            raise ValueError(msg)
        api_link = series_base_url + "?observations=1&series_ids={}".format(
            ",".join(map(urllib.parse.quote, series_ids))
        )
        return fetch_series_by_api_link(
            api_link,
            filters=filters,
            max_nb_series=max_nb_series,
            editor_api_base_url=editor_api_base_url,
            timeout=timeout,
        )

    msg = "Invalid combination of function arguments"
    raise ValueError(msg)


def fetch_series_by_api_link(
    api_link,
    max_nb_series=None,
    editor_api_base_url=default_editor_api_base_url,
    filters=None,
    timeout=None,
):
    """Fetch series given an "API link" URL.

    "API link" URLs can be found on DBnomics web site (https://db.nomics.world/) on dataset or series pages
    using "Download" buttons.

    If `filters` is not `None`, apply those filters using the Time Series Editor API
    (Cf https://editor.nomics.world/filters)

    Example:
    -------
      fetch_series(api_link="https://api.db.nomics.world/v22/series?provider_code=AMECO&dataset_code=ZUTN")

    """
    # Call API via `iter_series_infos`, add dimensions labels and store result in `series_list`.
    # Fill `datasets_dimensions`
    datasets_dimensions = None
    series_dims_by_dataset_code = defaultdict(dict)
    # series_dims_by_dataset_code example:
    #    {
    #        'WB/DB': {
    #            'EA19.1.0.0.0.ZUTN': { 'freq':'a', 'geo':'ea19', 'unit':'percentage-of-active-population'},
    #            'EA20.1.0.0.0.ZUTN': { 'freq':'a', 'geo':'ea20', 'unit':'percentage-of-active-population'},
    #            ...
    #        },
    #        ...
    #    }
    series_list = []
    for series_infos in iter_series_infos(api_link, max_nb_series=max_nb_series, timeout=timeout):
        complete_dataset_code = (
            series_infos["series"]["provider_code"] + "/" + series_infos["series"]["dataset_code"]
        )  # ex 'AMECO/ZUTN'
        if datasets_dimensions is None:
            # Let see if there's only one dataset returned by API, or many datasets
            datasets_dimensions = (
                series_infos["datasets_dimensions"]
                if "datasets_dimensions" in series_infos
                else {
                    # Only one dataset
                    complete_dataset_code: series_infos["dataset_dimensions"]
                }
            )
        series_list.append(series_infos["series"])
        # Store series dimensions information for future use
        series_dims_by_dataset_code[complete_dataset_code][series_infos["series"]["series_code"]] = series_infos[
            "series"
        ].get("dimensions", {})

    if len(series_list) == 0:
        return pd.DataFrame()

    common_columns = [
        "@frequency",
        "provider_code",
        "dataset_code",
        "dataset_name",
        "series_code",
        "series_name",
        "original_period",
        "period",
        "original_value",
        "value",
    ]

    # Flatten series received from the API to prepare Dataframe creation
    # (rename some keys of JSON result to match DataFrame organization)
    flat_series_list = []
    for series in series_list:
        flat_series = flatten_dbnomics_series(series)
        # Add dimensions labels to flat_series
        complete_dataset_code = flat_series["provider_code"] + "/" + flat_series["dataset_code"]  # ex: "AMECO/ZUTN"
        dataset_dimensions = datasets_dimensions[complete_dataset_code]
        if "dimensions_labels" in dataset_dimensions:
            dataset_dimensions_labels = dataset_dimensions["dimensions_labels"]
        else:
            dataset_dimensions_labels = {
                dim_code: f"{dim_code} (label)" for dim_code in dataset_dimensions["dimensions_codes_order"]
            }
        # Add dimensions values labels to current series
        if "dimensions_values_labels" in dataset_dimensions:
            for dimension_code in series.get("dimensions", {}):
                dimension_label = dataset_dimensions_labels[dimension_code]
                dimension_value_code = series_dims_by_dataset_code[complete_dataset_code][series["series_code"]][
                    dimension_code
                ]
                dimension_value_label = dict(dataset_dimensions["dimensions_values_labels"][dimension_code]).get(
                    dimension_value_code
                )
                if dimension_value_label:
                    flat_series[dimension_label] = dimension_value_label
        flat_series_list.append(flat_series)

    # Only applies if filters are used.
    if filters:
        common_columns.insert(common_columns.index("period") + 1, "period_middle_day")
        common_columns.append("filtered")
        filtered_series_list = [
            {**series, "filtered": True}
            for series in filter_series(
                series_list=series_list,
                filters=filters,
                editor_api_base_url=editor_api_base_url,
                timeout=timeout,
            )
        ]
        flat_series_list = [{**series, "filtered": False} for series in flat_series_list] + filtered_series_list

    # Compute dimensions_labels_columns_names and dimensions_codes_columns_names
    dimensions_labels_columns_names = []
    dimensions_codes_columns_names = []
    for complete_dataset_code in datasets_dimensions:
        for dimension_code in datasets_dimensions[complete_dataset_code]["dimensions_codes_order"]:
            dimensions_codes_columns_names.append(dimension_code)
            # We only add dimensions labels column if this information is present
            if "dimensions_labels" in dataset_dimensions and "dimensions_values_labels" in dataset_dimensions:
                dimensions_labels_columns_names.append(
                    datasets_dimensions[complete_dataset_code]["dimensions_labels"][dimension_code]
                )
            elif "dimensions_values_labels" in dataset_dimensions:
                # No dimensions labels but dimensions_values_labels -> we add " (label)" to the end
                # of dimension code
                dimensions_labels_columns_names.append(f"{dimension_code} (label)")
            # In the case there's no dimension_label nor dimensions_values_labels, we do not add any column

    # In the DataFrame we want to display the dimension columns at the right so we reorder them.
    ordered_columns_names = common_columns + dimensions_codes_columns_names + dimensions_labels_columns_names

    # Build dataframe
    dataframes = (pd.DataFrame(data=series, columns=ordered_columns_names) for series in flat_series_list)
    return pd.concat(objs=dataframes, sort=False)


def fetch_series_page(series_endpoint_url, offset, timeout=None):
    series_page_url = "{}{}offset={}".format(
        series_endpoint_url,
        "&" if "?" in series_endpoint_url else "?",
        offset,
    )

    try:
        response = _fetch_response(series_page_url, timeout=timeout)
    except RetryError as exc:
        raise FetchError(url=series_page_url) from exc

    response_json = response.json()

    series_page = response_json.get("series")
    if series_page is not None:
        assert series_page["offset"] == offset, (series_page["offset"], offset)

    return response_json


def filter_series(series_list, filters, editor_api_base_url=default_editor_api_base_url, timeout=None):
    if not editor_api_base_url.endswith("/"):
        editor_api_base_url += "/"
    apply_endpoint_url = urljoin(editor_api_base_url, "apply")
    return list(iter_filtered_series(series_list, filters, apply_endpoint_url, timeout=timeout))


def iter_filtered_series(series_list, filters, apply_endpoint_url, timeout=None):
    if timeout is None:
        timeout = default_timeout

    for series_group in grouper(editor_apply_endpoint_nb_series_per_post, series_list):
        # Keep only keys required by the editor API.
        posted_series_list = [
            {
                "frequency": series["@frequency"],
                "period_start_day": series["period_start_day"],
                "value": series["value"],
            }
            for series in series_group
        ]
        response = requests.post(
            apply_endpoint_url,
            json={"filters": filters, "series": posted_series_list},
            timeout=timeout,
        )
        try:
            response_json = response.json()
        except ValueError:
            log.error("Invalid response from Time Series Editor (JSON expected)")  # noqa: TRY400
            continue
        if not response.ok:
            log.error("Error with series filters: %s", json.dumps(response_json, indent=2))
            continue

        filter_results = response_json.get("filter_results")
        if not filter_results:
            continue

        for dbnomics_series, filter_result in zip(series_group, filter_results, strict=False):
            yield flatten_editor_series(series=filter_result["series"], dbnomics_series=dbnomics_series)


def iter_series_infos(api_link, max_nb_series=None, timeout=None):
    """Iterate through series.docs returned by API.

    Returns dicts of dataset(s) dimensions and series.
    The answer can have a key 'dataset_dimensions' if only one dataset is returned by API, or 'datasets_dimensions' if
    more than one dataset is returned.
     - datasets_dimensions or dataset_dimensions don't change between calls
     - series is the current series
    Example:
    {
       'datasets_dimensions': {
           "AMECO/ZUTN": {
               "code": "ZUTN",
               "converted_at": "2019-05-08T02:51:04Z",
               "dimensions_codes_order": ["freq", "unit", "geo" ...],
               ...
           },
           "CEPII/CHELEM-TRADE-GTAP": {
               "code": "CHELEM-TRADE-GTAP",
               "converted_at": "2019-01-29T15:53:30Z",
               "dimensions_codes_order": ["exporter", "importer", "secgroup", ...],
               ...
           },
      'series':
    }.
    """

    def yield_series(series, response_json):
        """Handle the cases of one-dataset and multi-datasets answer from API."""
        assert "datasets" in response_json or "dataset" in response_json
        if "datasets" in response_json:
            # Multi-datasets answer
            datasets_dimensions_dict = {"datasets_dimensions": response_json["datasets"]}
        else:
            # Mono-dataset answer
            datasets_dimensions_dict = {"dataset_dimensions": response_json["dataset"]}
        yield {"series": series, **datasets_dimensions_dict}

    total_nb_series = 0

    while True:
        response_json = fetch_series_page(api_link, offset=total_nb_series, timeout=timeout)

        errors = response_json.get("errors")
        if errors:
            for error in errors:
                log.error("%s: %s", error["message"], error)

        series_page = response_json["series"]

        num_found = series_page["num_found"]
        if max_nb_series is None and num_found > default_max_nb_series:
            raise TooManySeries(num_found, max_nb_series)

        page_nb_series = len(series_page["docs"])
        total_nb_series += page_nb_series

        # If user asked for a maximum number of series
        if max_nb_series is not None:
            if total_nb_series == max_nb_series:
                # Stop if we have enough series.
                break
            elif total_nb_series > max_nb_series:
                # Do not respond more series than the asked max_nb_series.
                nb_remaining_series = page_nb_series - (total_nb_series - max_nb_series)
                for series in series_page["docs"][:nb_remaining_series]:
                    yield from yield_series(series, response_json)
                break

        # If user didn't asked for a maximum number of series
        for series in series_page["docs"]:
            yield from yield_series(series, response_json)

        # Stop if we downloaded all the series.
        assert total_nb_series <= num_found, (
            total_nb_series,
            num_found,
        )  # Can't download more series than num_found.
        if total_nb_series == num_found:
            break


def flatten_dbnomics_series(series):
    """Adapt DBnomics series attributes to ease DataFrame construction.

    Rename some dict attributes, flatten other ones
    (the `series` dict is nested but we want a flat dict to build a DataFrame).
    """
    series = normalize_period(series)
    series = normalize_value(series)

    # Flatten dimensions.
    dimensions = series.get("dimensions") or {}
    series = {
        **without_keys(series, keys={"dimensions", "indexed_at"}),
        **dimensions,
    }

    # Flatten observations attributes.
    observations_attributes = series.get("observations_attributes") or []
    return {
        **without_keys(series, keys={"observations_attributes"}),
        **dict(observations_attributes),
    }


def flatten_editor_series(series, dbnomics_series):
    """Adapt Time Series Editor series attributes to ease DataFrame construction."""
    series = normalize_period(series)
    series = normalize_value(series)

    series = {
        **without_keys(series, keys={"frequency"}),
        "@frequency": series["frequency"],
        "provider_code": dbnomics_series["provider_code"],
        "dataset_code": dbnomics_series["dataset_code"],
        "dataset_name": dbnomics_series.get("dataset_name"),
        "series_code": "{}_filtered".format(dbnomics_series["series_code"]),
    }

    series_name = dbnomics_series.get("series_name")
    if series_name:
        series["series_name"] = f"{series_name} (filtered)"

    return series


def normalize_period(series):
    """Keep original period and convert str to datetime. Modifies `series`."""
    period = series.get("period") or []
    period_start_day = series.get("period_start_day") or []
    return {
        **without_keys(series, keys={"period_start_day"}),
        "original_period": period,
        "period": list(map(pd.to_datetime, period_start_day)),
    }


def normalize_value(series):
    """Keep original value and convert "NA" to None (or user specified value). Modifies `series`."""
    value = series.get("value") or []
    return {
        **series,
        "original_value": value,
        "value": [
            # None will be replaced by np.NaN in DataFrame construction.
            None if v == "NA" else v
            for v in value
        ],
    }


# UTILS


class FetchError(Exception):
    def __init__(self, *, url: str) -> None:
        msg = f"Could not fetch data from URL {url!r}"
        super().__init__(msg)
        self.url = url


@retry(
    after=after_log(log, logging.ERROR),
    stop=stop_after_attempt(3),
    wait=wait_random_exponential(max=60),
)
def _fetch_response(url, timeout=None):
    if timeout is None:
        timeout = default_timeout

    response = requests.get(url, allow_redirects=True, timeout=timeout)

    if response.status_code in {429, 500, 502, 503, 504}:
        raise TryAgain

    response.raise_for_status()

    return response


def grouper(n, iterable):
    """From https://stackoverflow.com/a/31185097/3548266.

    >>> list(grouper(3, 'ABCDEFG'))
    [['A', 'B', 'C'], ['D', 'E', 'F'], ['G']]
    """
    iterable = iter(iterable)
    return iter(lambda: list(itertools.islice(iterable, n)), [])


def without_keys(d, keys):
    return {k: v for k, v in d.items() if k not in keys}
