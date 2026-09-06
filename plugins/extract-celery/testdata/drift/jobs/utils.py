"""A plain function with a `delay` attribute of its own, which is not a task."""


def helper(n):
    return n


helper.delay = lambda n: helper(n)
