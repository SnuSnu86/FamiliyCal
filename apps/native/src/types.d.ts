declare module '@nozbe/watermelondb' {
  export const Model: any;
  export const tableSchema: any;
  export const appSchema: any;
  export const Database: any;
  export const Q: any;
}
declare module '@nozbe/watermelondb/adapters/sqlite' {
  const SQLiteAdapter: any;
  export default SQLiteAdapter;
}
declare module '@nozbe/watermelondb/adapters/lokijs' {
  const LokiJSAdapter: any;
  export default LokiJSAdapter;
}
declare module '@nozbe/watermelondb/decorators' {
  export const field: any;
  export const relation: any;
  export const children: any;
  export const text: any;
  export const date: any;
  export const readonly: any;
}
declare module '@nozbe/watermelondb/DatabaseProvider' {
  export const DatabaseProvider: any;
}
declare module '@react-native-community/netinfo' {
  const NetInfo: any;
  export default NetInfo;
}
