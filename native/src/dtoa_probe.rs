#[cfg(test)]
mod dtoa_probe {
    //! Temporary probe of the dtoa crate's output format.
    #[test]
    fn format_shapes() {
        let mut buf = dtoa::Buffer::new();
        for v in [
            1.5,
            0.1,
            1e21,
            1e-7,
            1e20,
            1381472817847324.2,
            1000000000000000128.0,
            5e-324,
            0.0,
            -1.0,
            1234567890123456789.0,
        ] {
            let s = buf.format(v);
            println!("{v:?} -> {s:?}");
        }
    }
}
