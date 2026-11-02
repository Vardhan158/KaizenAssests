from app.security.passwords import hash_password, verify_password, verify_with_legacy


def test_password_hashes_are_salted_and_adaptive() -> None:
    first = hash_password("correct horse battery staple")
    second = hash_password("correct horse battery staple")

    assert first.startswith("pbkdf2_sha256$600000$")
    assert first != second
    assert verify_password("correct horse battery staple", first)
    assert not verify_password("wrong", first)


def test_legacy_sha256_is_accepted_only_for_rehash() -> None:
    legacy = "6bed82f7da9a703f86f1d89288910edc2681b26d010db89c3666807d364e68a6"

    assert verify_with_legacy("legacy-password", legacy) == (True, True)
    assert verify_with_legacy("wrong", legacy) == (False, False)


def test_malformed_hash_is_rejected() -> None:
    assert verify_with_legacy("password", "not-a-valid-hash") == (False, False)
