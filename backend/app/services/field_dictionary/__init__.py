def apply_field_dictionary(*args, **kwargs):
    from .service import apply_field_dictionary as _impl

    return _impl(*args, **kwargs)


__all__ = ["apply_field_dictionary"]
