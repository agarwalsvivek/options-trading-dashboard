// Must be imported before the generated code so int64/uint64 decode as plain
// numbers (matching the `--force-number` typings) instead of Long objects.
import $protobuf from 'protobufjs/minimal.js';

$protobuf.util.Long = undefined as unknown as typeof $protobuf.util.Long;
$protobuf.configure();
